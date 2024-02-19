sudo apt update && sudo apt upgrade -y
npm install -g npm@10.4.0
npm install bun
curl -fsSL https://bun.sh/install | bash
bunx @astrojs/upgrade
bun install

bun add -d @types/bun

bunx --bun astro dev
bunx --bun astro build