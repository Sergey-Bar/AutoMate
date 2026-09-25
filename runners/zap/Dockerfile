FROM ghcr.io/zaproxy/zaproxy:2.16.1
WORKDIR /automation
COPY manifest.json /automation/manifest.json
RUN mkdir -p /automation/input /automation/output && chown -R 65532:65532 /automation
USER 65532:65532
ENTRYPOINT ["zap.sh", "-version"]
