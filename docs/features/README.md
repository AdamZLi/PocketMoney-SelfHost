# PocketMoney Features

This folder contains all product feature documentation for PocketMoney.

## Structure

```
features/
├── personas.md                              # Shared user persona definitions
├── README.md                                # This file
└── YYYY.M.DD-[feature-name]/               # One folder per feature
    ├── spec.md                              # Product specification (PMSpec Agent)
    └── design.md                            # UI/UX design document (Designer Agent)
```

## Conventions

- Each feature gets its own subfolder, named `YYYY.M.DD-[feature-name]` using the creation date
- `spec.md` is always created first by the PMSpec Agent
- `design.md` is created by the UI/UX Designer Agent after the spec is finalized
- `personas.md` at the root is shared across all features
