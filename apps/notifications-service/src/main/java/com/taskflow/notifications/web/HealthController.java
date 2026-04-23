package com.taskflow.notifications.web;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Lightweight health endpoint matching the shape core-api and analytics return.
 * Spring Boot Actuator provides a richer /actuator/health for deep checks;
 * this one is for quick curl / Docker HEALTHCHECK compatibility.
 */
@RestController
public class HealthController {

    @GetMapping("/health")
    public Map<String, Boolean> health() {
        return Map.of("ok", true);
    }
}
