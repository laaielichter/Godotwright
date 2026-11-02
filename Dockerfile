# Godotwright MCP server in a container, built from this repository.
# Used by MCP directories such as Glama to build and test the server; for your own use, `npx -y godotwright mcp` is simpler.
#
#   docker build -t godotwright .
#   docker run -i --rm -v "$PWD:/project" godotwright --project /project
#
# The tools that run Godot (check, test, play, screenshot, session, perf) need a Godot 4.7 binary, which this image does
# not hold; the rest works without it.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm ci --ignore-scripts && npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY data ./data
COPY PRIVACY.md LICENSE ./
USER node
ENTRYPOINT ["node", "dist/cli.js", "mcp", "--tier", "premium"]
