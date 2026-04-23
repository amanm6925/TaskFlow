package com.taskflow.notifications.events;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Stub that decides what email would be sent for each event. Currently logs
 * the decision — real delivery (Resend client + circuit breaker + audit log)
 * lands in a follow-up PR.
 */
@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    public void handle(TaskEvent event) {
        switch (event.type()) {
            case "task.created" -> onCreated(event);
            case "task.updated" -> onUpdated(event);
            case "task.deleted" -> onDeleted(event);
            default -> log.warn("unknown event type {} — ignoring (event_id={})", event.type(), event.id());
        }
    }

    private void onCreated(TaskEvent e) {
        log.info("[would email] new task {} '{}' in org {} — recipients: reporter={} assignee={}",
            e.displayKey(), e.title(), e.orgId(), e.reporterId(), e.assigneeId());
    }

    private void onUpdated(TaskEvent e) {
        // A more sophisticated version would diff old/new state; for now we just signal.
        log.info("[would email] task {} '{}' updated (status={}) — assignee={}",
            e.displayKey(), e.title(), e.status(), e.assigneeId());
    }

    private void onDeleted(TaskEvent e) {
        log.info("[would email] task {} deleted in org {}", e.displayKey(), e.orgId());
    }
}
