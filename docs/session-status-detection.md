# VibePulse Session Status Detection

## Overview

VibePulse uses a multi-layer detection mechanism to determine the real-time status of OpenCode sessions (idle/busy/retry). Since OpenCode's native status reporting is sparse and delayed, the system combines multiple signals to improve status accuracy.

---

## Core Concepts

### Status Definitions

| Status | Meaning | Column |
|--------|---------|--------|
| `idle` | Idle / Completed | Idle Column |
| `busy` | Actively Running | Busy Column |
| `retry` | Waiting for User Input / Retry | Needs Attention Column |

---

## Detection Architecture

```mermaid
flowchart TB
    subgraph Input["Input Signal Layer"]
        A1["OpenCode /session/status\nSparse, often empty"]
        A2["Message Part Status\nrunning/completed/waiting"]
        A3["Session Metadata\nupdated/created timestamps"]
    end
    
    subgraph Process["Status Processing Layer"]
        B1["Part Status Analysis"]
        B2["Sticky State Management\n1s one-way buffer"]
        B3["Child Session Cascade"]
    end
    
    subgraph Output["Output Layer"]
        C1["realTimeStatus"]
        C2["waitingForUser"]
        C3["Kanban Column Assignment"]
    end
    
    A1 --> B1
    A2 --> B1
    A3 --> B2
    B1 --> B2
    B2 --> C1
    B2 --> B3
    B3 --> C2
    C1 --> C3
    C2 --> C3
```

---

## Key Detection Mechanisms

### 1. Part Status Analysis

Extracts part status from recent session messages to determine activity:

```mermaid
flowchart TD
    A["Fetch last 8 messages"] --> B{"Any running part?"}
    B -->|Yes| C["Status = busy"]
    B -->|No| D{"Any waiting part?"}
    D -->|Yes| E["Status = retry\nwaitingForUser = true"]
    D -->|No| F{"All parts completed?"}
    F -->|Yes| G["Likely idle"]
    F -->|No| H["Unknown state"]
```

**Key Limitation**: Only checks the last 8 messages. Tasks with long periods of no output are misclassified as completed.

---

### 2. One-Way Sticky State (Core Mechanism)

Prevents status jitter using a **one-way buffering strategy**:

```mermaid
flowchart LR
    subgraph IdleToBusy["idle → busy"]
        A1["Detected busy"] --> A2["Immediate effect"]
        A2 --> A3["Update lastBusyAt = now"]
    end
    
    subgraph BusyToIdle["busy → idle"]
        B1["Detected idle"] --> B2{"lastBusyAt\nwithin 1s?"}
        B2 -->|Yes| B3["Keep busy\n(sticky)"]
        B2 -->|No| B4["Actually become idle"]
    end
```

**Design Rationale**:
- `idle → busy`: **Immediate effect** (once busy is detected, it's truly running)
- `busy → idle`: **25-second buffer** (prevents misclassification from brief state loss)

---

### 3. Child Session Cascade

Parent session status is influenced by child sessions:

```mermaid
flowchart TB
    subgraph Parent["Parent Session"]
        P1["realTimeStatus: idle"]
        P2["But has child sessions"]
    end
    
    subgraph Children["Child Session States"]
        C1["Child 1: busy"]
        C2["Child 2: idle"]
        C3["Child 3: retry"]
    end
    
    P1 --> D{"Any child session active?"}
    C1 --> D
    C2 --> D
    C3 --> D
    
    D -->|Yes| E["effectiveStatus = busy\nDisplay in Busy Column"]
    D -->|No| F["effectiveStatus = idle\nDisplay in Idle Column"]
```

---

## Complete State Transition Flow

```mermaid
sequenceDiagram
    participant OC as OpenCode
    participant API as /api/sessions
    participant Sticky as Sticky State Manager
    participant UI as Kanban UI
    
    Note over OC,UI: Scenario: Long-running task
    
    OC->>OC: Task starts (busy)
    OC->>API: /session/status = busy
    API->>Sticky: Update lastBusyAt
    Sticky->>UI: Display busy
    
    Note over OC,UI: 10 seconds later, OpenCode stops sending status
    
    OC->>API: /session/status = null (sparse)
    API->>Sticky: Query lastBusyAt
    Sticky-->>Sticky: now - lastBusyAt = 0.5s < 1s
    Sticky->>UI: **Keep busy** (sticky)
    
    Note over OC,UI: 30 seconds later
    
    API->>Sticky: Query lastBusyAt
    Sticky-->>Sticky: now - lastBusyAt = 2s > 1s
    Sticky->>UI: **Become idle**
```

---

## Detection Limitations (Shortcomings)

### Root Cause: Unreliable Signal Source

```mermaid
flowchart TB
    subgraph RootCause["Root Cause: Insufficient OpenCode Signals"]
        R1["No heartbeat mechanism\nCannot prove 'I am computing'"]
        R2["Sparse status reporting\n/session/status often empty"]
        R3["Discrete part status\nOnly running/completed, no progress"]
    end
    
    subgraph Workarounds["Current Workarounds"]
        W1["Time buffer (1s sticky)"]
        W2["Message history inference (8 messages)"]
        W3["Child session cascade"]
    end
    
    RootCause --> Workarounds
```

### Specific Shortcomings

| Shortcoming | Impact Scenario | User Experience |
|-------------|-----------------|-----------------|
| **1. Shallow message sampling** | Long computation without output | Misclassified as idle, user thinks task finished |
| **2. Fixed time window** | One-size-fits-all approach | 1s may be too short for some tasks |
| **3. No CPU/IO monitoring** | Process hang or deadlock | Continuously shows busy, user waits in vain |
| **4. Cannot detect deep subtask nesting** | Nested agent calls | Grandchild task status not trackable |
| **5. Network jitter sensitive** | Brief disconnection | May trigger unnecessary stale state |
| **6. Audio-visual out of sync** | Rapid status switching | Sound plays before/after card movement, disjointed experience |

### Misclassification Example

```mermaid
sequenceDiagram
    participant User as User
    participant UI as VibePulse Kanban
    participant Task as Background Task
    
    Note over User,Task: Scenario: Data analysis task running
    
    User->>UI: Check kanban
    UI->>Task: Query status
    Task-->>UI: busy (second 1)
    UI-->>User: Display Busy ✓
    
    Note over User,Task: Task continues, but no new messages
    
    Task->>Task: Continuous computation (no output)
    
    Note over User,Task: After 1 second...
    
    UI->>Task: Query status
    Task-->>UI: No status / completed parts
    UI-->>UI: Sticky window expired
    UI-->>User: Display Idle ✗ (Misclassification!)
    
    User->>User: Confused: Did the task finish?
```

### Improvement Directions (Not Implemented)

| Improvement | Difficulty | Impact | Priority |
|-------------|------------|--------|----------|
| Increase message sampling depth (50 messages) | Low | Reduce misclassification | P2 |
| Process-level CPU monitoring | Medium | Detect deadlocks | P1 |
| Adaptive time window (by task type) | Medium | Precise judgment | P3 |
| MCP Progress Token integration | High | Accurate progress | P1 (requires OpenCode support) |
| Heartbeat keepalive mechanism | High | Real-time status | P2 (requires protocol change) |

---

## Key Time Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `STATUS_STICKY_BUSY_WINDOW_MS` | 1 second | Buffer window for busy → idle transition |
| `CHILD_ACTIVE_WINDOW_MS` | 30 minutes | Child session activity determination window |
| `CHILD_UNKNOWN_STATE_BUSY_WINDOW_MS` | 2 minutes | Busy assumption for unknown states |
| `STALL_DETECTION_WINDOW_MS` | 30 seconds | Stall detection (if updated time is within this window) |
| `STATUS_STICKY_RETENTION_MS` | 24 hours | Sticky state memory retention time |

---

## Data Flow Summary

```mermaid
flowchart LR
    A["OpenCode\nTrue State"] -->|Sparse signals| B("VibePulse\nMulti-layer detection")
    B -->|Sticky buffering| C["Stable State"]
    C -->|transform| D["Kanban Cards"]
    D -->|Animation| E["UI Column Movement"]
    
    F["Sound Alert"] -.->|Delayed 250ms| E
```

**Core Design Philosophy**: Due to unreliable upstream (OpenCode) signals, the system provides **good enough** stability through **time buffering** and **multi-layer inference**, rather than absolute precision.
