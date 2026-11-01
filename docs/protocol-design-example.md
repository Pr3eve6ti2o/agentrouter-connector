# Fault-tolerant, offline-first distributed synchronisation protocol for collaborative note-taking

Design and analysis assembled from six bounded Astra jobs, after the single 5,000-word job failed with reasoning starvation (16,000 reasoning tokens, 0 text). Model text below is unedited; only the title, this provenance note, section headings and ordering were added.

| Part | Section | Job | Host / key | Result |
|---|---|---|---|---|
| 1 | System model and assumptions | 0240ca49-71ce-495e-9eda-91ab79244579 | agentrouter.org / key 0 | completed, attempt 1, 197,465 ms |
| 2 | Consistency guarantees with a proof sketch | e000f471-b401-4581-9fca-4c6381d5aa2f | ps.air-outer.com / key 0 | completed, attempt 1, 285,253 ms |
| 3 | Conflict resolution for text and structured data | f6ee3f36-7f7b-404a-9ba1-a2e6900c84da | agentrouter.org / key 0 | completed, attempt 1, 316,604 ms |
| 4 | Security and adversarial sync data | e825d55d-a12a-484d-b08d-ee08baefb6c0 | ps.air-outer.com / key 0 | completed, attempt 1, 271,785 ms |
| 5 | Failure modes and recovery | af893222-93be-4396-888e-b13063332560 | agentrouter.org / key 0 | completed, attempt 1, 251,324 ms |
| 6 | Complete test matrix | ef33ec35-d758-4215-b024-7dbe5890e2b1 | ps.air-outer.com / key 0 | completed, attempt 1, 256,307 ms |

All parts: gpt-6-astra, reasoning=max, 16,000-token cap, worker SSE path, 1 November 2026, 15:10–15:36 UTC.

## System model and assumptions

# System model and assumptions

## Replicas and scope

The system consists of mobile and desktop clients and a logically central synchronisation service backed by durable storage. Each client installation is an independent replica; signing into two devices does not make them one actor. Clients exchange updates through the service, so collaborators need not be connected simultaneously. Service outages prevent propagation, not local work. The client population changes through explicit enrolment, replacement, and removal.

A workspace is the replication and authorisation boundary. An enrolled client stores its workspace’s note text and metadata locally. Large attachments are separate, immutable objects: their references replicate with notes, but only cached bytes are available offline. Initial enrolment and access to uncached content require connectivity.

## Data and operation identity

Replicated state includes notes, stable note and block identifiers, text, titles, tags, and deletion state. Local changes are represented as independently identifiable operations. Renaming a note does not change its identity; two notes titled “Meeting” remain distinct.

Every operation has a globally unique, stable identifier, such as an actor-incarnation identifier paired with a persistent counter. Retries retain that identifier. Reinstallation or restoration of an earlier storage image requires a fresh incarnation before generating further operations. Identifier collisions are assumed negligible, and clients can generate identifiers without contacting the service.

Atomicity is local to a declared edit transaction. No cross-workspace transaction or globally serial execution of edits is assumed.

## Time and causality

Devices have independent clocks that may drift, jump, or be incorrectly configured. Wall-clock timestamps may support display and diagnostics, but cannot establish causality or prove that an offline replica has permanently disappeared.

Causal order follows local operation order and observed remote dependencies, transitively. Two operations are concurrent when neither causally precedes the other. For example, Alice can rename a note while Bob, offline, edits its first paragraph. Neither change supersedes the other merely because one device’s clock is ahead. Concurrent text edits and edits racing with deletion are normal inputs; conflict resolution cannot rely on their absence.

## Communication and progress

Communication is asynchronous. Messages may be lost, duplicated, reordered, or delayed indefinitely during a partition. Connections can fail midway through a transfer, and mobile operating systems may suspend clients. No exactly-once transport, reliable failure detector, or bounded round-trip time is assumed.

Safety must not depend on reconnection within a deadline. Progress is conditional: after updates stop, participating replicas must receive sufficient execution time and recurring connectivity to transfer outstanding, retained operations. Under a **fair-delivery assumption**, indefinitely retried traffic over a usable path eventually succeeds. The service must also eventually recover and schedule each participating workspace; network reachability alone is insufficient. A permanently disconnected device cannot be promised convergence.

## Failures and durability

Clients and service nodes may crash and recover. Local storage is assumed to provide atomic commits and honour durability barriers. An edit is **saved locally** only after enough information to reconstruct it and publish it later has been durably committed. An optimistic screen update alone is not a durability guarantee.

A durable-upload acknowledgement means the service has committed the update under its declared storage-failure budget—for example, surviving loss of up to \(f\) storage replicas. Receipt into memory is insufficient. The value of \(f\) and the corresponding failure domains are deployment parameters.

Local and remote durability are separate states. If Alice’s phone is destroyed before its offline edits reach another durable copy, those edits may be lost. Permanent loss of every copy and undetected storage corruption are outside the guarantees.

## Trust and authorisation

Transport is authenticated and encrypted using assumed-secure cryptography. Replicas are crash-faulty, not Byzantine: compromised endpoints, maliciously fabricated histories, and service equivocation are outside this model. The service is trusted to enforce workspace membership; identity alone does not establish permission.

Cached write permission allows tentative offline editing, not irrevocable admission to shared state. Publication is authorised against membership when the service admits an upload, rather than against the client’s claimed edit time. Consequently, edits on a disconnected collaborator’s tablet may be rejected after access is revoked, even if the collaborator claims to have written them earlier. Rejected work remains recoverable locally rather than silently disappearing. Revocation cannot erase plaintext already downloaded by a collaborator.

## Retention and resource assumptions

Clients have finite storage and may exhaust it. A client unable to commit an edit must report that it is not saved; it must not acknowledge durability and later discard unpublished work to reclaim space. The selected workspace’s structured state is assumed to fit its configured local-storage budget.

No maximum offline interval is needed for safety. However, unlimited offline catch-up and bounded retained metadata cannot both be assumed. Retention policies may explicitly retire inactive replication incarnations, independently of user access rights. A returning retired replica must re-enrol from a current baseline, retaining unpublished edits for reconciliation or export. Transparent replay of arbitrarily old operations after their identifying metadata has been discarded is outside the guarantee. Silence alone is not evidence that a replica has consumed history.

## Consistency boundary

Offline-first means previously synchronised notes remain readable and locally editable without contacting another replica, subject to storage capacity and cached permissions. It does not mean offline state is current, or that every locally saved edit is already authorised for publication.

After edits stop and the progress conditions hold, active, authorised replicas must eventually contain the same admitted operations and derive the same shared note state. Equal admitted operation sets must yield equal shared states despite duplication or delivery order; private drafts and attachment caches may differ. These are protocol obligations, not properties supplied by the network. Global linearizability, instantaneous revocation on disconnected devices, and preservation of every collaborator’s semantic intent are not promised.

## Consistency guarantees with a proof sketch

## Consistency guarantees with a proof sketch

### Contract and assumptions

The protocol provides **strong eventual consistency (SEC)**, causal visibility, and session guarantees—not linearizability. A device whose session dependencies are local can acknowledge edits during a partition without contacting peers.

Assume non-Byzantine crash–recovery faults, unique operation identifiers, identical merge rules, and durable storage that survives restart. Eventual convergence additionally requires eventual connectivity and fair anti-entropy: each retained operation eventually reaches every participating replica of the same dataset. Every acknowledged edit and its dependencies must remain recoverable at some participant. Losing the sole device containing an offline edit is data loss, not something convergence can repair.

### State and conflict semantics

A replica maintains a durable, grow-only operation set \(O\). Each operation has a unique `(replica incarnation, counter)` identifier, a Lamport clock, and a causal context covering all operations visible at creation. Counters are never reused within an incarnation. The total ordering key is `(Lamport clock, incarnation, counter)`; clocks increase across causal dependencies without relying on physical time. Note IDs are creation-operation IDs, and all note edits depend on creation.

Define \(C(O)\) as the operations in \(O\) whose entire transitive dependency set is also in \(O\). Out-of-order arrivals remain invisible until this condition holds. Both visibility and local acknowledgement follow durable persistence.

Each read renders one snapshot of \(C(O)\) using these rules:

- **Text:** each insertion creates one character element identified by its operation ID, anchored to a causally prior element or a permanent start sentinel. Render by preorder traversal, ordering children by descending operation key. Deletion hides identified elements but retains their anchors and descendants.
- **Scalar fields:** titles and similar fields use the write with the greatest operation key. This is a logical-time winner, not necessarily the last real-time edit.
- **Note deletion:** a tombstone permanently hides its note ID, including concurrent edits. Restoration creates a new note ID.

For example, starting from `AB`, two offline replicas insert `x` and `y` after `A`. Both insertions sort before the older `B`; if `x` precedes `y` under the tie-break, the result is `AxyB` everywhere. Deleting character `A` produces `xyB`, not orphaned insertions.

### Guarantees

- **Strong convergence:** replicas incorporating the same operations render identical logical notes, regardless of delivery order, duplication, or earlier crashes.
- **Eventual incorporation:** under the communication and survival assumptions, every acknowledged operation eventually enters every participant’s visible causal context. A losing rename or an edit to a deleted note may be incorporated without appearing in rendered content.
- **Causal visibility:** happens-before, written \(a \rightarrow b\), includes session order, observed dependencies, and their transitive closure. No snapshot incorporates \(b\) without incorporating \(a\). Conflict resolution may nevertheless hide \(a\)’s effect.
- **Read-your-writes and monotonic reads:** a session’s successive snapshots include its acknowledged writes and never regress in incorporated history. This does not mean text only grows: a remote deletion can remove previously displayed characters.
- **No identity resurrection:** once a replica incorporates a deletion, receiving older insertions or edits cannot restore the deleted character or note identity. Explicit recreation uses a fresh identity.

These session guarantees hold on one device. Across devices, the session carries its last causal context, and the destination serves it only after acquiring that context. Such migration can block during a partition; silently serving an older snapshot would violate the guarantee.

### Proof sketch

**1. Merge algebra.** Merge is set union:

\[
O_1 \sqcup O_2 = O_1 \cup O_2.
\]

Union is associative, commutative, and idempotent; local edits and received operations only enlarge \(O\). Consequently, message order and duplicate retransmissions cannot change the merged set. Durable publication prevents a restart from rolling back acknowledged or observed history.

**2. Causal closure.** By definition, \(C(O)\) is dependency-closed. If \(O \subseteq O'\), then \(C(O) \subseteq C(O')\): acquiring operations cannot invalidate an already satisfied dependency. Local edits depend on the origin’s visible context; session transfer enforces the same inclusion at another device. Induction over published snapshots therefore establishes causal visibility, read-your-writes, and monotonic reads.

**3. Deterministic projection.** An insertion references only an anchor in its causal past, so anchor edges cannot cycle. Unique ordering keys determine a unique traversal. Tombstone membership and maximum-key field selection are also deterministic. Equal incorporated operation sets therefore produce equal content; equal durable sets necessarily produce equal incorporated sets. Because deletion evidence never disappears, delayed edits cannot undo deletion.

**4. Eventual progress.** Each acknowledged operation has a finite dependency closure retained under the survival assumption. Fair exchange delivers that closure; induction over dependency order eventually admits the operation to \(C(O)\). After edits cease, each participant reaches the same union \(O^*\) of recoverable operations, proving eventual convergence. With continuing edits, the guarantee is per-operation incorporation, not simultaneous identical snapshots.

### Limits of the guarantee

No bounded staleness, global real-time order, or serialisable cross-note transactions are promised. Two isolated devices may display different titles even if one rename finished before the other began. A permanent partition can preserve that divergence indefinitely. SEC also does not guarantee preservation of every author’s intention: concurrent text runs may interleave, and concurrent scalar writes can lose.

The proof assumes deletion evidence and dependencies remain available. Compaction is safe only if it preserves these guarantees under every permitted future merge. Elapsed time alone cannot establish this when an arbitrarily old offline replica may return.

## Conflict resolution for text and structured data

## Conflict resolution for text and structured data

### Causal merge contract

Use typed conflict-free replicated data types (CRDTs), not whole-note last-writer-wins replacement. Each operation has an immutable `(replica-incarnation, counter)` ID, a causal context, and a Lamport timestamp advanced beyond every observed timestamp. Change the replica incarnation after rollback or counter-state loss to prevent identifier reuse. Causal context determines whether edits are concurrent; wall-clock time never decides conflicts.

Define one total priority, `(Lamport timestamp, replica-incarnation, counter)`, for deterministic ordering. Given the same valid operation set, replicas must produce the same document regardless of delivery order or duplication. Operations referencing unknown dependencies remain pending rather than being reinterpreted against current offsets.

### Text and formatting

Represent each text block as a replicated growable array. Each Unicode scalar has a stable insertion ID, a predecessor ID or start sentinel, and a deletion tombstone. Linearise by depth-first traversal, visiting siblings in descending priority order. A new insertion after a visible character therefore precedes its older successor; concurrent insertions at that predecessor receive deterministic order.

A paste creates a chain of atoms rather than repeatedly inserting at one anchor. Independent concurrent pastes of `red` and `blue` at the same predecessor produce a `redblue` or `bluered` fragment according to priority, not an arbitrary character shuffle. Neither order claims linguistic correctness.

Deletion names the exact atom IDs observed by the editor. Tombstones hide those atoms without removing their ordering role. From `cat`, A inserts `r` after `a` while offline B deletes `t`; merging yields `car`. B cannot delete the unseen `r`, even though it occupies the former offset of `t`. Concurrent insertions at deleted anchors remain ordered through the retained tombstones.

Selections snap to grapheme boundaries, although storage uses Unicode scalars. Do not normalise Unicode during merging. Formatting targets observed atom IDs, not mutable offsets; each attribute follows the scalar-register rule below. New atoms carry explicitly inherited attributes. Thus concurrent bolding affects only text the formatter observed, avoiding ambiguous range expansion. Run-length encoding may compress this representation without changing its semantics.

### Structured fields and collections

Structured objects are maps keyed by immutable IDs, with independently mergeable properties. A completion toggle and a due-date change both survive. Use multi-value registers for atomic scalar properties: each write replaces values in its causal past but retains concurrent candidates. Display the highest-priority candidate provisionally and expose different alternatives as a conflict. Titles are atomic here to preserve competing rewrites rather than blend them character-by-character. Equal displayed values may be coalesced, but their contributing causal IDs must remain.

Tags use an add-wins observed-remove set. Removing `research` cancels only additions the remover observed; a concurrent re-addition survives. Removing it after observing the merge removes all then-visible additions. This favours retaining an explicit, unseen addition over interpreting an earlier removal as a permanent prohibition.

Preserve coupled invariants through atomic values. Store `(reminder time, time zone)` as one register; field-wise merging could invent a combination nobody wrote. Validate candidates against the agreed schema, not a receiver’s transient state. Derived values such as word count are recomputed from canonical text, not independently merged.

### Deletion and structural conflicts

Deletion dominates edits to a block incarnation: the block disappears, but concurrent edits remain available as recoverable content. Restoration copies content under fresh object and atom IDs; delayed edits cannot resurrect the original. A subtree deletion enumerates observed descendants. Concurrently created descendants survive under an undeletable recovery root if their parent is deleted. This distinguishes intentional deletion of known content from accidental destruction of unseen work.

Treat a move as an atomic register write of `(parent ID, position token)`, where the token is a sortable sequence identifier allocated between neighbouring positions. Select one placement per block using the register priority; never represent concurrent moves as two copies. Preserve alternative placements as conflict candidates. Order siblings by position token, then block ID.

Independent moves can create a cycle: one replica moves A under B while another moves B under A. Build the view from selected parent edges, identify each cycle, and redirect its lowest-priority edge to the recovery root, using block ID as a final tie-breaker. Recompute this deterministic projection after relevant merges. Do not emit repair operations based on whichever partial view first reveals the cycle; those repairs would introduce timing-dependent choices.

### Explicit resolution and retained evidence

Resolving a conflict creates an ordinary replicated write. Suppose offline replicas choose Friday and Monday for the same due date. A subsequent choice made with both candidates observed includes both in its causal context and supersedes them. A third, still-undelivered candidate remains concurrent and must surface later. Offer explicit choices and manual editing with author/context previews; local labels such as “mine” never affect canonical ordering.

Undo also creates operations. Undoing an insertion deletes only its atom IDs; undoing a deletion inserts equivalent text under fresh IDs. It does not rewind other collaborators’ history, and text they inserted at the affected anchors remains present.

Retain tombstones and causal summaries while stale operations remain admissible. Reclamation must prevent replay against discarded identities; age alone is insufficient with long-offline replicas. Persistent identities and retained alternatives cost space, but deleting this evidence prematurely can turn retries into resurrection or data loss.

Convergence follows because the underlying joins are associative, commutative and idempotent, while every ordering and structural projection depends only on merged evidence. These guarantees establish a shared document, not semantic agreement: awkward sentences, competing deadlines and recovered blocks can still require human review.

## Security and adversarial sync data

## Security and adversarial sync data

### Threat model and trust boundaries

Treat relays, storage servers, and newly discovered peers as untrusted. They may replay, omit, reorder, truncate, or fabricate sync data. Authorized collaborators may submit destructive but correctly signed edits. The goals are confidentiality from infrastructure, device-attributed authorship, scoped authorization, and bounded processing—not proof that an editor is benevolent. A compromised endpoint can disclose everything it can decrypt; revocation cannot retract copied plaintext. Use TLS, but make integrity and authorization independently verifiable by every client.

### Authenticated envelopes and encrypted content

Give each device a signing key protected by the platform keystore. Enrol it with a notebook authority’s signed grant specifying user, scope, and permissions. Pin this membership trust root through an authenticated invitation or an existing trusted member; the server must not substitute keys.

Each operation carries a canonical, versioned envelope: notebook/document IDs, author-device ID, membership epoch, device sequence number, dependency hashes, and encrypted payload. Sign the header and ciphertext with protocol-specific domain separation, and bind the header as authenticated encryption’s associated data. Compute the operation ID over those canonical bytes, excluding the signature itself. Retransmit stored envelopes unchanged. Duplicate delivery is idempotent; signatures cannot be transplanted between notebooks.

Encrypt each authorization scope with epoch-specific keys distributed only to permitted devices. Use standard authenticated encryption with nonce uniqueness across crashes and restoration—for example, XChaCha20-Poly1305 with OS-generated random nonces. If durable device sequence state is lost, enrol a fresh device identity before publishing writes. Relays still learn routing identifiers, sizes, timing, and some membership information.

### Authorization while offline

Keep membership changes in an authority-signed, monotonic epoch chain, separate from note content. Validate permissions against this chain, never against role fields inside an edit. Decryption capability does not confer edit permission. The authority’s temporary absence must not prevent preparing edits in the last known epoch.

Revocation needs a signed cutoff, not an author-supplied timestamp. When closing epoch 12, the authority commits to a validated causal frontier: only operations in its causal closure remain admissible from epoch 12. A removed device cannot append backdated writes by claiming they were created yesterday. However, an honest offline device may also have edits outside the cutoff. Retain them as recovery drafts, withdraw them from shared state when the cutoff is learned, and let still-authorized users explicitly reapply them in epoch 13.

Rotate encryption keys for the new epoch. This protects new content, not historical plaintext. Uninformed offline replicas can still accept old-epoch edits provisionally: instantaneous global revocation during a partition is impossible. The cutoff trades unconditional acceptance of offline edits for deterministic revocation.

### Validate before merging

Use a bounded pipeline: cap frames before allocation; check envelope syntax and signatures; establish authorization; authenticate and decrypt; then validate CRDT semantics before mutating shared state. Reject duplicate map keys, unsupported mandatory fields, out-of-range integers, illegal object references, and cross-document targets. Bound dependency lists, insertions, nesting, and decompressed attachment size. Missing dependencies mean “pending,” not “invalid”; fetch ancestors under bounded work budgets.

Validity rules must be deterministic and versioned. Local queue pressure may delay a valid operation, but must not permanently invalidate it on only one replica. If a device signs different operations at the same sequence number, retain the evidence and quarantine both branches pending an authority-signed resolution; never select by arrival order.

Apply accepted operations atomically with their deduplication records, so crashes cannot cause duplicate application. Invalid operations and their dependent subgraphs remain outside the materialized document; independent operations continue.

### Rollback and dishonest storage

Persist the latest verified membership head and sync frontier locally; an older server response cannot replace them. Snapshots must commit to the authorized frontier and complete CRDT state, including deletion metadata. Verify state by replay from a trusted checkpoint, not merely by checking a collaborator’s snapshot signature. A peer’s claimed clock must never, by itself, authorize tombstone pruning. A relay acknowledgement is not proof of durable replication or permission to discard the only local copy.

Gossip signed heads to expose forks when peers reconnect. Signatures cannot force disclosure of withheld edits. A new installation without a trusted checkpoint cannot establish freshness from the server alone; sensitive recovery requires confirmation from an existing trusted device.

### Resource exhaustion and unsafe presentation

Cap unauthenticated work globally and per connection. After authentication, enforce per-device and per-notebook byte, operation, signature-verification, and pending-dependency budgets with fair scheduling and backpressure. Do not charge forged traffic against its claimed author’s allowance. A billion advertised missing hashes must not cause a billion fetches. Relays enforce envelope limits; endpoints repeat those checks and validate decrypted semantics. Fetch objects through configured origins, not arbitrary URLs supplied by sync records.

Treat note bodies and attachments as hostile application input. Sanitize rendered HTML, prohibit executable embeds and dangerous URL schemes, avoid automatic external fetches, and isolate attachment decoders. Valid signatures do not make content safe. A permitted editor’s mass deletion may be protocol-valid: retain recoverable authenticated history and show attribution rather than claiming cryptography prevents abuse.

Test forged grants, cross-notebook replays, stale epochs, equivocation, dependency floods, decompression bombs, hostile markup, and crash/replay boundaries. Fuzz parsers and assert that malformed or unauthorized envelopes leave accepted state unchanged. Log operation IDs and rejection reasons, never note plaintext or keys.

## Failure modes and recovery

## Failure modes and recovery

Recovery assumes immutable, uniquely identified operations, causal frontiers, and a durable local journal. **Saved locally** means surviving process and operating-system restarts, subject to platform durability guarantees. **Replicated** means surviving the configured server-replica failure budget. Neither status means every offline collaborator has received the edit.

### Device crashes and storage exhaustion

Commit each local operation, its identifier allocation, and its pending-upload record in one durable transaction before displaying “saved”. Speculative typing may be rendered immediately, but remains unsaved until commit. After a crash, discard incomplete transactions and rebuild derived indexes from the committed journal. Persist received operations and their receipt cursor atomically, so recovery cannot skip operations that were never stored.

Disk exhaustion must not trigger eviction of unsynchronised operations. Stop acknowledging saves and show an actionable error. After restoration from a device backup, retain existing operation IDs but allocate a new device incarnation for future edits; otherwise a restored counter can reuse an ID already accepted elsewhere.

### Partitions, duplicates, and reordering

When connectivity disappears, editing continues against local state; availability indicators must not imply freshness. Retry uploads with capped exponential backoff and jitter, reusing the original operation IDs. For example, if the server commits an edit but its acknowledgement is lost, resending must return the existing outcome, not insert its text twice. Deduplication must survive restarts and compaction through persisted operation IDs or checkpoint coverage.

Exchange causal frontiers to discover missing ranges. Receiving `A:12` before `A:11` must not advance a contiguous frontier beyond `A:10`. Buffer operations requiring missing predecessors and request those predecessors. Bound buffers and request a checkpoint when incremental repair becomes impractical; never discard local pending edits to relieve pressure.

### Server failure and split brain

Report **replicated** only after the operation is committed by the replication protocol and persisted on the required quorum. During quorum loss, local editing remains available, but replication stays pending. An isolated server must not acknowledge durable replication merely because it stored an upload locally.

After leader failure, reconnect to an authoritative replica and reconcile frontiers. Do not blindly resume a cursor tied to the failed server’s log generation. Fence obsolete leaders from checkpoint publication, membership changes, and garbage collection. Otherwise, two partitions could independently discard history needed for reconciliation. Logical causality, not wall-clock timestamps, governs recovery; clock skew must not cause edits to be discarded.

### Long disconnections and compaction

Log truncation requires a verified checkpoint, durable on the required quorum, covering every removed operation. Tombstone collection additionally needs a safe epoch transition: all non-expired devices drain old-epoch writes and switch to references supported by the checkpoint. Devices excluded after lease expiry must follow stale-device recovery, not upload old references blindly.

Suppose a phone reconnects after four months with an insertion anchored to a character whose tombstone has been collected. Preserve its old base and pending journal, fetch a verified checkpoint into staging storage, and atomically switch the active base. Exclude pending operations already covered by the checkpoint; automatically replay the remainder only where their references remain valid.

If safe replay is impossible, reconstruct the offline branch from retained local state and expose it as a recovered note or reviewable patch. Do not invent new IDs and silently reapply everything. Unlimited offline duration, bounded history, and transparent recovery cannot all be guaranteed.

### Semantic conflicts

Deterministic merging prevents replica divergence, not loss of user intent. If Ana deletes a note while Ben edits it offline, a delete-wins result must still preserve Ben’s text in recoverable history and offer a recovered copy. Avoid silently resurrecting the shared note or dropping his edits.

Concurrent paragraph rewrites may also converge into unwanted prose. Preserve attributable history and provide selective undo or a reviewable restoration. Submit recovery as new operations rather than rewinding the shared log, which could erase unrelated collaborators’ changes.

### Corruption and rejected operations

Validate checksums, schemas, operation-ID/payload consistency, and resource limits before accepting data. Quarantine invalid records instead of propagating them. Repair from another replica or from a verified checkpoint plus log, checking against committed digests or a trusted backup. Conflicting payloads under one ID are an integrity fault, not a last-writer-wins conflict. Block dependent operations visibly while allowing causally independent notes to synchronise.

Unsupported operation versions require an upgrade or read-only mode, not best-effort reinterpretation. Expired credentials trigger reauthentication, not endless retries. Uploads created before access revocation still require current permission. Keep rejected edits explicitly unsynchronised; preserve or export them only as allowed by local retention and security policy.

### Recovery verification and hard limits

Fault-injection tests should crash clients and servers around every commit/acknowledgement boundary, duplicate and reorder packets, exhaust storage, and reconnect devices beyond retention limits. Assert no duplicate effects, no acknowledged-data loss within the failure budget, and convergence after editing stops and delivery resumes.

Mark a note synchronised only after its pending edits are accepted and the peer’s captured frontier is integrated. Rejected work remains separately recoverable, never silently counted as synchronised. This establishes convergence to a known frontier, not global freshness across offline devices.

After total replica loss, restore a verified backup and replay surviving device journals; disclose any gap beyond the backup’s recovery point. An unsynchronised edit held only on a destroyed device is unrecoverable.

## Complete test matrix

## Complete test matrix

### Harness and correctness oracles

Use a deterministic harness with three clients (A, B, C), replicated sync services, persistent stores, and independently controlled directed links. Inject faults at transaction, flush, acknowledgement, message-delivery, and snapshot boundaries. Record seeds, operation IDs, causal metadata, storage images, and schedules for replay. Distinguish local-durable acknowledgements from replicated acknowledgements. Run each trace without faults first.

Check safety after every event: acknowledgements match their durability guarantees; duplicate delivery has no additional effect; shared-state authorisation boundaries hold; accepted operations remain accounted for under the conflict rules. Compare against an independent reference model, not just another replica. Once editing stops and fair delivery resumes, require convergence of materialised notes and causal coverage, with eligible outboxes draining. Permanent partitions do not have a convergence deadline.

### Coverage dimensions

Cross scenarios with these classes using pairwise coverage, supplemented by mandatory compound failures:

- **Topology:** one, two, three, and maximum supported clients; service outages; asymmetric and multi-way partitions.
- **Content:** empty, Unicode-heavy, large, deleted, and attachment-bearing notes; payload sizes at zero, limit−1, limit, and limit+1.
- **Lifecycle:** foreground/background, process death, reboot, account switch, supported OS/storage combinations, and mixed protocol versions.
- **History:** fresh and divergent replicas; immediately before, at, and after retention expiry; clock jumps; concurrent edits; missing dependencies.

### Mandatory scenarios

Pin exact conflict outcomes in golden fixtures. Agreement on an incorrect document is not success. Document and justify feature-specific exclusions.

| ID | Stimulus / injected fault | Required result |
|---|---|---|
| T01 | Disconnect A; create, read, edit, and delete cached notes; restart; reconnect. | Local actions remain available; committed work survives restart and synchronises without manual intervention. |
| T02 | Kill A before/after local commit, send, and acknowledgement; inject disk-full and failed flushes. | No false durability claim or partially committed operation; acknowledged local work survives recoverable crashes. |
| T03 | Lose, duplicate, reorder, truncate, and replay operation batches and acknowledgements. | Retries are idempotent; missing data is repaired; incomplete operations never commit. |
| T04 | Partition A from B/C; introduce one-way links and repeated flaps, then heal. | Replicas continue permitted work; reconnection eventually converges without starving a client or document. |
| T05 | From `ab`, A inserts `X` and B inserts `Y` after `a`; C concurrently deletes `b`. | Require the fixture’s exact insertion order, each insert appearing once, and no remaining `b`. |
| T06 | Concurrent title replacements, tag add/remove, and moving a note while its notebook is deleted. | Exact field-level merge outcomes hold; hierarchy and reference invariants remain valid. |
| T07 | Delete versus edit, repeated delete, explicit restore, and delayed pre-delete replay. | Apply the declared delete/edit rule; stale replay alone never resurrects a note. |
| T08 | Unicode combining marks, emoji sequences, multiline paste, and undo after another client edits. | Encoding remains valid; replicated positions and undo preserve the specified editing semantics. |
| T09 | Deliver dependants before prerequisites; omit a history range; replay stale sync summaries. | Buffer or reject safely; retrieve missing dependencies; never report completion while required causal gaps remain. |
| T10 | Corrupt or truncate journals/snapshots; tear writes; restart during recovery. | Detect damage; recover from verified state or replicas; report irrecoverable local-only loss instead of silently dropping edits. |
| T11 | Crash an endpoint after commit but before reply; lose service replicas at and beyond declared fault tolerance. | Within tolerance, replicated acknowledgements survive. Beyond tolerance, report unavailable or unrecoverable state rather than claiming successful recovery. |
| T12 | Interrupt snapshot download/install; interleave tail operations; deliver an older snapshot afterward. | Installation is atomic; pending local edits survive; tail operations apply once; version regression is rejected. |
| T13 | Keep C offline beyond compaction/tombstone retention; edit there; reconnect. | Enforce epoch/resnapshot rules without stale resurrection; preserve or explicitly quarantine unsynchronisable local edits. |
| T14 | Restore cloned stores; collide operation IDs with different payloads; move clocks backward/forward. | No silent identity reuse or payload substitution; clock skew cannot violate causality or indefinitely suppress retries. |
| T15 | Mix supported client versions; migrate storage containing queued edits; crash mid-migration. | Compatible histories converge; migrations resume or roll back atomically; unsupported versions fail explicitly without damaging data. |
| T16 | Revoke access while A is offline; expire tokens; switch accounts before reconnection. | Deny prohibited uploads/new downloads; isolate account queues; visibly quarantine rejected edits. Previously cached plaintext is not retrospectively revocable. |
| T17 | Fuzz schemas, authentication, lengths, nesting, and cross-notebook references; replay forged requests. | Bounded rejection without crashes, unauthorised state changes, data leakage, or retry amplification. |
| T18 | Interrupt and duplicate attachment chunks; corrupt content; delete a note during upload. | Verify hashes; resume safely; never expose partial blobs; collect orphans only when reference and retention rules permit. |
| T19 | Bootstrap empty C while A edits across paginated downloads; remove and re-add subscriptions. | Snapshot plus tail produces complete permitted state, without pagination gaps, cross-notebook leakage, or lost local edits. |
| T20 | Run hot-note contention, maximum backlog, slow links, throttling, and prolonged service failure. | Verify foreground latency, resource budgets, retry/backpressure bounds, fair scheduling, and explicit storage exhaustion; never silently evict pending edits. |

### Compound coverage and release gates

Mandatory compound runs are:

- Offline edits + tombstone compaction + client restart.
- Partition + service failover + lost acknowledgement.
- Mixed-version upgrade + duplicate replay + disk pressure.

Rotate which replica fails and which initiates recovery.

Exhaustively explore bounded small-state models. Run seeded property tests on every change, transport/storage chaos nightly, and long-duration, device, and version suites before release. Shrink failures into permanent regressions.

Every performance fixture must specify hardware, bandwidth, workload, and numeric acceptance limits. Report local-edit p99, reconvergence time, bytes per accepted operation, peak memory, retries, and oldest queued-operation age.

Map every normative protocol requirement to a test ID. Release requires all mandatory rows and compound schedules to pass, recovery within fixture deadlines after connectivity restoration, and compliance with resource budgets. Unexplained coverage gaps or skipped cases block release.
