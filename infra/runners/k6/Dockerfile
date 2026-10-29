FROM grafana/k6:0.57.0@sha256:70af91f86cd8e142e0544a4edaf79835a80033f71974b92edd5ac36fd4442a7b
USER root
WORKDIR /automation
COPY manifest.json /automation/manifest.json
RUN mkdir -p /automation/input /automation/output && chown -R 65532:65532 /automation
USER 65532:65532
ENTRYPOINT ["k6", "version"]
