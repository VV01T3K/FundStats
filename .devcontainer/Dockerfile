FROM mcr.microsoft.com/devcontainers/base:trixie


RUN apt-get update && apt-get install -y --no-install-recommends nodejs xdg-utils
USER vscode

RUN curl -fsSL https://vite.plus | bash
ENV PATH="/home/vscode/.vite-plus/bin:/home/vscode/.local/bin:${PATH}"
RUN vp install -g bun btca