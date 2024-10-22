{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_22
    bun
    unzip
    (pkgs.writeShellScriptBin "hello" ''
      #!/usr/bin/env bash
      echo "Hello, in my simple nix configuration for crypto-dad!"
    '')
    (pkgs.writeShellScriptBin "setup" ''
      #!/usr/bin/env bash
      bun install
    '')
    (pkgs.writeShellScriptBin "update" ''
      #!/usr/bin/env bash
      bun upgrade
      bun install
      bun update
      bunx @astrojs/upgrade
    '')
    (pkgs.writeShellScriptBin "dev" ''
      #!/usr/bin/env bash
      bunx --bun astro dev
    '')
  ];
}