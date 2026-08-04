sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0

git submodule update --remote core

git tag -d v0.3.3
git tag -a v0.3.3 -m "0.3.3"
git push --tags
