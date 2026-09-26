FROM nginx:1.27-alpine
# Unprivileged, on 8080, for the same reasons as web.Dockerfile: the stock image
# runs as root only because it binds 80, and the only capability it needs
# afterwards is none.
RUN chown -R nginx:nginx /var/cache/nginx /var/run /etc/nginx/conf.d \
  && sed -i 's|pid /var/run/nginx.pid;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf
COPY infra/nginx/edge.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
USER nginx
