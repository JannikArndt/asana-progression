# asana-progression on CapRover. The app (dist/) is built in CI and shipped in the deploy
# tarball (scripts/deploy-tar.mjs), so the image only installs the server's dependencies:
# what /version reports is exactly the build CI verified.
#
# Base image pinned by digest; Dependabot proposes new digests (never a new Node major).
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
RUN apk add --no-cache su-exec
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/
ENV NODE_ENV=production PORT=80 DATA_DIR=/data DIST_DIR=/app/dist
# Starts as root only to hand /data (the asana-data volume) to node, then runs as node.
ENTRYPOINT ["docker-entrypoint.sh"]
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/version').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
