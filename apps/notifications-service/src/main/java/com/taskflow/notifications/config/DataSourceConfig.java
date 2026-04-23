package com.taskflow.notifications.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.net.URI;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Parses the Postgres-style DATABASE_URL_APP (postgresql://user:pass@host:port/db)
 * that the rest of the TaskFlow services use, and translates it into the
 * jdbc:postgresql://... form Spring's HikariCP expects.
 *
 * Keeps env var shape consistent across Node, Python, and Java services.
 */
@Configuration
public class DataSourceConfig {

    @Bean
    public DataSource dataSource(@Value("${DATABASE_URL_APP}") String rawUrl) {
        URI uri = URI.create(rawUrl);
        String userInfo = uri.getUserInfo();
        if (userInfo == null || !userInfo.contains(":")) {
            throw new IllegalStateException("DATABASE_URL_APP must include user:password");
        }
        int colon = userInfo.indexOf(':');
        String user = userInfo.substring(0, colon);
        String password = userInfo.substring(colon + 1);
        int port = uri.getPort() > 0 ? uri.getPort() : 5432;
        String path = uri.getPath();
        if (path == null || path.isEmpty() || path.equals("/")) {
            throw new IllegalStateException("DATABASE_URL_APP must include a database name");
        }
        String jdbcUrl = "jdbc:postgresql://" + uri.getHost() + ":" + port + path;

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(jdbcUrl);
        config.setUsername(user);
        config.setPassword(password);
        config.setDriverClassName("org.postgresql.Driver");
        // Small pool — this service is a background consumer. The LISTEN loop
        // takes its own connection outside the pool, so this is only for
        // occasional queries (health checks, future idempotency lookups).
        config.setMaximumPoolSize(5);
        config.setMinimumIdle(1);
        config.setPoolName("taskflow-notifications");
        return new HikariDataSource(config);
    }
}
