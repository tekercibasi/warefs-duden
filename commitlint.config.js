module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "subject-case": [2, "always", ["sentence-case", "lower-case"]],
    "scope-enum": [1, "always", ["api", "web", "docs", "infra", "deps"]],
  },
};
