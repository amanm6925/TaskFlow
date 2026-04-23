# --- build stage -------------------------------------------------------------
# gradle:8.11-jdk21 ships Gradle + JDK, so we skip the wrapper bootstrap.
FROM gradle:8.11-jdk21 AS build

WORKDIR /app

# Copy build files first so Docker caches the deps layer independently of source.
COPY --chown=gradle:gradle settings.gradle build.gradle ./

# Pre-resolve dependencies. The `|| true` is belt-and-suspenders:
# `dependencies` can exit non-zero on some projects even when successful.
RUN gradle --no-daemon dependencies > /dev/null 2>&1 || true

COPY --chown=gradle:gradle src ./src

# bootJar creates the executable fat-jar at build/libs/<name>-<version>.jar
RUN gradle --no-daemon bootJar

# --- runtime stage -----------------------------------------------------------
FROM eclipse-temurin:21-jre-noble AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl dumb-init ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app --create-home app

WORKDIR /app

COPY --from=build --chown=app:app /app/build/libs/*.jar /app/app.jar

USER app

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -sf http://127.0.0.1:3003/health || exit 1

# JVM tuning for the 1GB VM:
#   -Xmx256m caps heap regardless of host/container RAM
#   -XX:+UseContainerSupport reads cgroup limits (default on JDK 21 but explicit)
#   -Djava.security.egd speeds SecureRandom seeding on container boot
ENTRYPOINT ["dumb-init", "--", "java", \
    "-Xmx256m", \
    "-XX:+UseContainerSupport", \
    "-Djava.security.egd=file:/dev/./urandom", \
    "-jar", "/app/app.jar"]
