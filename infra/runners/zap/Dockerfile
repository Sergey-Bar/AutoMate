FROM ghcr.io/zaproxy/zaproxy:2.17.0@sha256:030d3df57735dacbb83464854758e674dd9ad01d79d12a129a8e58b1fd384238
USER root
WORKDIR /automation
COPY manifest.json /automation/manifest.json
# uid 65532 needs a passwd entry, or Java's user.home is `?` and ZAP cannot create its home,
# and the upstream Firefox profile, or the client add-on hangs on `firefox -CreateProfile`.
# ZAP's own state goes to /tmp/zap, so the manifest's read-only root needs only a /tmp tmpfs.
RUN mkdir -p /automation/input /automation/output /automation/home \
  && cp -a /home/zap/.mozilla /automation/home/.mozilla \
  && chown -R 65532:65532 /automation \
  && echo 'automate:x:65532:65532::/automation/home:/sbin/nologin' >> /etc/passwd
USER 65532:65532
ENTRYPOINT ["zap.sh", "-dir", "/tmp/zap", "-version"]
