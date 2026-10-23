package tz.go.tcrms.api;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class HealthController {

    /**
     * Liveness-only endpoint. This deliberately does not expose database details
     * or personal/operational information.
     */
    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("application", "TCRMS API", "status", "UP");
    }
}
