FROM nginx:1.27-alpine
COPY infra/nginx/edge.conf /etc/nginx/conf.d/default.conf
