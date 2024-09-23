{ pkgs ? import <nixpkgs> {}}:

pkgs.mkShell {
    packages = with pkgs; [ 
        pkgs.hello
        nodejs_22
        bun
    ];
}