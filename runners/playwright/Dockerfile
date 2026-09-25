FROM node:24.21.0-alpine
WORKDIR /automation
COPY manifest.json /automation/manifest.json
RUN mkdir -p /automation/input /automation/output && chown -R 65532:65532 /automation
USER 65532:65532
ENTRYPOINT ["node", "-e", "console.log('playwright runner image')"]
