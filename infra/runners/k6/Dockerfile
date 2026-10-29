FROM grafana/k6:2.3.0@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8
USER root
WORKDIR /automation
COPY manifest.json /automation/manifest.json
RUN mkdir -p /automation/input /automation/output && chown -R 65532:65532 /automation
USER 65532:65532
ENTRYPOINT ["k6", "version"]
