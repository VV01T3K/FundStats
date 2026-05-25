FROM mcr.microsoft.com/devcontainers/base:trixie

USER vscode

RUN curl -fsSL https://vite.plus | bash
ENV PATH="/home/vscode/.vite-plus/bin:/home/vscode/.local/bin:${PATH}"