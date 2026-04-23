package com.taskflow.notifications.events;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import javax.sql.DataSource;
import org.postgresql.PGConnection;
import org.postgresql.PGNotification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Subscribes to Postgres NOTIFY on the `task_events` channel.
 *
 * Owns a dedicated long-lived JDBC connection (not pooled) because LISTEN is
 * bound to a specific session — if the connection goes back to the pool, the
 * subscription dies. Runs the blocking poll loop on a virtual thread so it
 * doesn't tie up a platform thread indefinitely.
 *
 * Reconnects with capped backoff on any SQLException — that covers network
 * blips, Postgres restarts during deploys, etc.
 */
@Component
public class TaskEventListener {

    private static final Logger log = LoggerFactory.getLogger(TaskEventListener.class);
    private static final String CHANNEL = "task_events";
    private static final int POLL_TIMEOUT_MS = 10_000;
    private static final long INITIAL_BACKOFF_MS = 1_000;
    private static final long MAX_BACKOFF_MS = 30_000;

    private final DataSource dataSource;
    private final NotificationService notificationService;
    private final ObjectMapper objectMapper;
    private volatile boolean running = true;

    public TaskEventListener(DataSource dataSource,
                             NotificationService notificationService,
                             ObjectMapper objectMapper) {
        this.dataSource = dataSource;
        this.notificationService = notificationService;
        this.objectMapper = objectMapper;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        Thread.ofVirtual()
            .name("pg-listen-" + CHANNEL)
            .start(this::runLoop);
    }

    private void runLoop() {
        long backoff = INITIAL_BACKOFF_MS;
        while (running) {
            try {
                subscribeAndPoll();
                // If subscribeAndPoll returned cleanly (shutdown), stop.
                break;
            } catch (Exception e) {
                log.warn("LISTEN loop errored, reconnecting in {}ms: {}", backoff, e.toString());
                sleepQuietly(backoff);
                backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
            }
        }
        log.info("LISTEN loop stopped");
    }

    private void subscribeAndPoll() throws SQLException {
        try (Connection conn = dataSource.getConnection()) {
            // Required: LISTEN is per-session, must stay on this connection.
            conn.setAutoCommit(true);
            try (Statement stmt = conn.createStatement()) {
                stmt.execute("LISTEN " + CHANNEL);
            }
            log.info("listening on Postgres channel '{}'", CHANNEL);

            PGConnection pg = conn.unwrap(PGConnection.class);
            while (running) {
                // Blocks up to POLL_TIMEOUT_MS or until a notification arrives.
                PGNotification[] notifs = pg.getNotifications(POLL_TIMEOUT_MS);
                if (notifs != null) {
                    for (PGNotification n : notifs) {
                        handleRaw(n.getParameter());
                    }
                }
            }
        }
    }

    private void handleRaw(String payload) {
        try {
            TaskEvent event = objectMapper.readValue(payload, TaskEvent.class);
            log.debug("received event id={} type={} task={}", event.id(), event.type(), event.displayKey());
            notificationService.handle(event);
        } catch (Exception e) {
            // A malformed payload shouldn't tear down the subscription.
            // Log loudly so we notice if core-api starts emitting garbage.
            log.error("failed to parse task_events payload: {}", payload, e);
        }
    }

    private static void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
