FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bullseye


# Update and upgrade packages
RUN apt update && apt upgrade -y

WORKDIR /workspaces/crypto-dad

# Install npm
RUN npm install -g npm@10.4.0

# Install bun using npm
RUN npm install -g bun && bun upgrade