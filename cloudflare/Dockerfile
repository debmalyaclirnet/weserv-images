# Cloudflare Containers image for weserv/images (Alpine-based, ~105MB).
#
# Derived from ../docker/alpine.Dockerfile. Builds the weserv nginx module from
# this repo's source. Alpine keeps the image small so it boots quickly in
# Cloudflare's Firecracker microVM. Also runs fine on any Docker host:
#   docker build -f cloudflare/Dockerfile -t weserv:local .
#   docker run -d -p 8080:8080 --name weserv weserv:local
#
# Cloudflare / portability adaptations:
#  - strip CRLF from shell/config files (Windows core.autocrlf checkout)
#  - redirect nginx cache/temp off /dev/shm to disk (no configurable shm, and
#    avoids needing --shm-size locally)
#  - error_log via the `stderr` keyword (the /dev/stderr path fails in Firecracker)
#  - listen on non-privileged ports (8080 public / 8081 internal)
#  - make writable dirs permissive
#
# Build context is the repository root (see image_build_context in wrangler.jsonc).
FROM alpine:3.24

LABEL maintainer="Kleis Auke Wolthuizen <info@kleisauke.nl>"

ARG NGINX_VERSION=1.31.2

# Copy the contents of this repository to the container
COPY . /var/www/imagesweserv
WORKDIR /var/www/imagesweserv

# Strip CRLF from the shell scripts sourced during the build (Windows checkout).
# busybox sed's \r handling is unreliable, so use tr.
RUN for f in config config.make; do tr -d '\r' < "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done \
    # Create nginx user/group
    && addgroup -g 101 -S nginx \
    && adduser -S -D -H -u 101 -h /var/cache/nginx -s /sbin/nologin -G nginx -g nginx nginx \
    # Bring in build dependencies
    && apk add --no-cache --virtual .build-deps \
        build-base \
        curl \
        git \
        meson \
        openssl-dev \
        pcre2-dev \
        vips-dev \
    # Build and install Meson-based project
    && meson setup build --prefix=/usr -Dcli=true \
    && meson compile -C build \
    && meson install -C build \
    # Build and install nginx along with the weserv module
    && mkdir nginx \
    && curl -Ls https://nginx.org/download/nginx-$NGINX_VERSION.tar.gz | \
        tar xzC nginx --strip-components=1 \
    && cd nginx \
    && ./configure \
        --prefix=/etc/nginx \
        --sbin-path=/usr/sbin/nginx \
        --modules-path=/usr/lib/nginx/modules \
        --conf-path=/etc/nginx/nginx.conf \
        --error-log-path=/var/log/nginx/error.log \
        --http-log-path=/var/log/nginx/access.log \
        --http-client-body-temp-path=/var/cache/nginx/client_temp \
        --http-proxy-temp-path=/var/cache/nginx/proxy_temp \
        --http-fastcgi-temp-path=/var/cache/nginx/fastcgi_temp \
        --http-uwsgi-temp-path=/var/cache/nginx/uwsgi_temp \
        --http-scgi-temp-path=/var/cache/nginx/scgi_temp \
        --pid-path=/run/nginx.pid \
        --lock-path=/run/nginx.lock \
        --user=nginx \
        --group=nginx \
        --add-module=/var/www/imagesweserv \
        --with-file-aio \
        --with-http_ssl_module \
        --with-http_v2_module \
        --with-http_realip_module \
        --with-http_stub_status_module \
        --with-http_secure_link_module \
        --with-pcre-jit \
    && make -j$(nproc) \
    && make install \
    && cd ../ \
    # Remove build directories and dependencies
    && rm -rf build nginx \
    && apk del --no-network .build-deps \
    # Bring in runtime dependencies
    && apk add --no-cache \
        libheif-svtenc \
        openssl \
        pcre2 \
        vips-cpp \
        vips-jxl \
        vips-heif \
        vips-magick \
        vips-poppler \
    # Bring in tzdata so users could set the timezones through the environment variables
    && apk add --no-cache tzdata \
    # Ensure nginx cache directory exist with the correct permissions
    && mkdir -m 700 /var/cache/nginx \
    # NOTE: the stock image symlinks weserv-access.log -> /dev/stdout and
    # weserv-error.log -> /dev/stderr to forward logs to Docker. Do NOT do that
    # here: opening /dev/stdout /dev/stderr by path fails with ENXIO
    # ("No such device or address") inside Cloudflare's Firecracker microVM and
    # crashes nginx at startup. nginx writes these to regular files instead; the
    # main error_log uses the `stderr` keyword (below) which does reach CF logs.
    # Copy nginx configuration to the appropriate location
    && cp ngx_conf/*.conf /etc/nginx \
    # --- Cloudflare Containers adaptations ---------------------------------
    # Normalize CRLF on the runtime configs, move cache/temp off /dev/shm to
    # disk, log to stderr (keyword, not /dev/stderr path), and relax dir perms.
    && for f in /etc/nginx/*.conf; do tr -d '\r' < "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done \
    && sed -i 's#/dev/shm#/var/cache/nginx#g' /etc/nginx/nginx.conf /etc/nginx/imagesweserv.conf \
    && sed -i 's#error_log /var/log/nginx/error.log#error_log stderr#' /etc/nginx/nginx.conf \
    && chmod 777 /var/cache/nginx /var/log/nginx /run
    # -----------------------------------------------------------------------

# Move nginx off privileged port 80 to 8080 (public listener the Worker targets)
# and 8081 (internal engine server + upstream). Non-privileged ports avoid any
# dependency on the container running as root.
RUN sed -i \
        -e 's#server 127.0.0.1:80;#server 127.0.0.1:8081;#' \
        -e 's#listen 80 default_server;#listen 8080 default_server;#' \
        -e 's#listen \[::\]:80 default_server#listen [::]:8080 default_server#' \
        -e 's#listen 80;#listen 8081;#' \
        /etc/nginx/imagesweserv.conf

# Set default timezone (can be overridden with -e "TZ=Continent/City")
ENV TZ=Europe/Amsterdam \
    # Increase the minimum stack size to 2MB (musl's default thread stack is tiny)
    VIPS_MIN_STACK_SIZE=2m

EXPOSE 8080

STOPSIGNAL SIGQUIT

CMD ["nginx", "-g", "daemon off;"]
