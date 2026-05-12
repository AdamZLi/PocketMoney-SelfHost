# PocketMoney — Feature Summary

*Last updated: 2025-07-10*

PocketMoney is a self-hosted personal finance tracker that helps you import, categorize, and understand your spending. It combines rule-based automation with AI assistance to minimize manual work while keeping you in full control of your data.

## Features

### 📊 Dashboard

- Month-to-date spending total, treatment-aware (excludes refunds, splits shared costs, amortizes large purchases)
- Spending breakdown by parent category for the current month
- "To Review" queue showing the 25 most recent unreviewed transactions with inline category, treatment, and reviewed-status editing
- Quick links to Transactions and Trends pages

### 💳 Transactions

- Browse all transactions with newest-first sorting
- Search by merchant name; filter by account, category, month, date range, treatment type, and review status
- Inline editing of category (searchable dropdown), treatment, and notes
- Rename merchants with autocomplete from known names; renaming automatically creates an alias rule for future imports
- View the original bank-provided source name alongside the cleaned display name
- Mark transactions as reviewed with a single click
- Bulk select and delete transactions
- Duplicate detection to find and merge repeated entries
- Rule suggestions: when you change a category, the app offers to create a rule so similar transactions are auto-categorized in the future

### 📥 Import

- Upload CSV or XLSX files from any bank or credit card
- Automatic column detection with manual mapping fallback
- Merchant names are automatically cleaned using your alias rules
- Category rules are applied automatically; uncategorized rows can be sent to AI for suggestions
- Duplicate detection against both the current batch and existing transactions, with merge/keep/flag options
- Source name column shows the original bank name; edited names display a badge
- Inline correction of merchant names during staging, with aliases auto-created on commit
- Category and account selectable per row before committing
- Progress indicator during AI categorization and batch commit

### 🏷️ Categories

- Create, edit, and delete spending categories with optional parent–child grouping
- Manage categorization rules: match by "contains," "equals," or regex pattern
- Rules are priority-ordered; higher-priority rules take precedence
- Deleting a category prompts reassignment of affected transactions

### 🔄 Merchant Aliases

- Create alias rules using "contains" or "exact" match types with a sentence-style form
- Search and filter your alias list by pattern or display name
- Expand any alias to see all raw source names it has matched
- Reassign an alias to a different display name, with retroactive updates to all matching transactions
- Auto-created aliases when you rename a merchant in Transactions or correct a name during Import

### 🏦 Accounts

- Add bank accounts and credit cards with name, last-four digits, type, and institution
- Supports credit card, debit card, checking, savings, cash, and other account types
- Soft-delete accounts to preserve transaction history

### 📈 Trends

- Monthly spending bar chart with stacked category breakdown and moving-average line
- Filter by time range (3, 6, 12 months, year-to-date, or all time), account, category, and custom date range
- Category treemap showing proportional spending at a glance
- Treatment-aware calculations: amortized purchases spread across months, refundable items excluded, shared costs show only your portion
- Click any month to drill into its transactions
- Comparison against baseline monthly average

### 🤖 AI Features

- **Import categorization:** uncategorized transactions are sent to an AI model that suggests categories with confidence scores; low-confidence suggestions are flagged for review
- **Review agent:** an AI agent scans your transactions and proposes both a category and a treatment (normal, excluded, refundable, reimbursable, amortized) with a confidence level and plain-language reason
- **Learning loop:** every time you accept or override an AI suggestion, your decision is recorded so the AI personalizes future proposals to your preferences

### 👀 Review

- **Owed to you** tab: pending reimbursable transactions grouped by person, showing how much each person owes
- **Pending refunds** tab: refundable transactions still awaiting a refund
- **Settled** tab: previously pending items that have been resolved
- Search and filter by person; mark items as settled or revert them to pending
- Click any item to open a detail sheet for editing treatment, category, or notes
