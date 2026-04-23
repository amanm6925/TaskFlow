package com.taskflow.notifications.events;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Payload shape that core-api sends over pg_notify('task_events', ...).
 * Kept intentionally loose — unknown properties ignored so we can evolve the
 * producer without breaking the consumer.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record TaskEvent(
    String id,
    String type,
    String orgId,
    String projectId,
    String projectKey,
    String taskId,
    Integer taskNumber,
    String title,
    String status,
    String reporterId,
    String assigneeId
) {
    public String displayKey() {
        return projectKey != null && taskNumber != null
            ? projectKey + "-" + taskNumber
            : (taskId != null ? taskId : "?");
    }
}
