module.exports = {
  apps: [{
    name: "hon-sma-worker",
    script: "node_modules/.bin/tsx",
    args: "worker/server.ts",
    cwd: "/home/devjoy/Hon-SMA",
    env: { NODE_ENV: "production" },
  }],
};
