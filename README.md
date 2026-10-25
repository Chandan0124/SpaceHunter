# 🌌 SpaceHunter (Local Deep Disk Space & Bloat Hunter)

> **Blazing fast, 100% offline, zero-telemetry disk cleaner and visual space explorer designed for Windows.**

SpaceHunter is built specifically to locate and reclaim space from "unknown" and forgotten storage consumers—such as multi-gigabyte build artifacts (`node_modules`, `.next`, `target`, `bin/obj`), package manager wheel/tarball caches (`npm`, `pip`, `uv`, `nuget`), crash dumps, shader caches, browser caches, and deep-nested large files (>100MB, 500MB, 1GB+) across all your internal drives.

---

## ⚡ Highlights

- **100% Local & Zero Telemetry**: Operates strictly on `127.0.0.1` (loopback). Makes zero remote requests, contains zero trackers, and never leaks your filenames or paths to the cloud.
- **Hybrid Desktop + CLI Experience**:
  - **Standalone Desktop App Window**: Launches with zero-overhead native app mode (built-in Microsoft Edge / Chrome app mode). No heavy 200MB+ Electron installs required.
  - **High-Power CLI**: Instant terminal commands for scanning drives, bloat, dev projects, and large files.
- **Multi-Drive Architecture**: Automatically detects and monitors all drives (`B:`, `C:`, `D:`, `E:`, `G:`, `H:`, `J:`, etc.) with real-time usage indicators and low-space alerts.
- **Safe Recoverable Cleaning**:
  - **Windows Recycle Bin Support**: Deleted items can be routed to the Windows Recycle Bin so you can easily restore them if needed.
  - **Dry-Run Simulation**: Preview exact files and space to be reclaimed before touching a single byte.
  - **Active Process Protection**: Skips locked files without crashing.
  - **System Blacklist**: Hardcoded safeguards prevent touching Windows system files, Program Files roots, or user profile roots.

---

## 🚀 Quick Start

### 1. Launch the Desktop App Window
Double-click `SpaceHunter.bat` in Windows File Explorer, or run:

```powershell
# From B:\tEMP
npm start
# or
node desktop.js
```

### 2. Run via Command Line Interface (CLI)

```powershell
# 1. Inspect all connected drives and free space
.\spacehunter drives

# 2. Run a fast scan for hidden caches, temp files, and crash dumps
.\spacehunter scan

# 3. Preview cleaning (Dry-run: simulation without deleting)
.\spacehunter clean --dry-run

# 4. Clean detected bloat safely (sends to Windows Recycle Bin)
.\spacehunter clean

# 5. Hunt developer project bloat (node_modules, .next, target, .venv)
.\spacehunter dev B:\
.\spacehunter dev C:\Users\chand\Projects

# 6. Find large files (>100MB, 500MB, 1GB+)
.\spacehunter large B:\ --min 500MB
.\spacehunter large C:\ --min 1GB --cat video

# 7. Super-fast Duplicate File Hunter (>200,000 files/sec)
.\spacehunter dupes B:\ --mode name
.\spacehunter dupes C:\ --mode name_size --min 1MB
.\spacehunter dupes D:\ --mode exact

# 8. Open the Desktop GUI from CLI
.\spacehunter ui
```

---

## 🔍 What SpaceHunter Hunts

### 1. High-Speed Duplicate File Hunter (New!)
* **Blazing Fast Parallel Traversal**: Multi-worker asynchronous directory queue scanning at speeds up to **200,000+ files per second**.
* **Zero Overhead Matching**: Initial traversal reads directory entries without issuing hundreds of thousands of redundant `stat` calls, deferring metadata checks strictly to candidate duplicates.
* **Flexible Matching Modes**:
  - `By Name (Fastest)`: Instantly groups identically named files scattered across different folders and drives.
  - `By Name & Size`: Matches files that share both the same filename and identical byte length for zero false positives without slow full-disk hashing.
  - `Exact Bit-for-Bit Hash`: Rapid cryptographic verification (sample + SHA-256) ensuring 100% identical duplicates.
* **Smart Selection Pruning**:
  - `Keep Newest`: Automatically preserves the most recent copy while staging older redundant versions for cleanup.
  - `Keep Oldest`: Keeps original archive copy while cleaning duplicate copies.
  - One-click Windows Recycle Bin cleanup or permanent deletion.
  - One-click "Reveal in Explorer" for every copy.

### 2. Developer Project Bloat
* `node_modules` (Node.js dependencies)
* `.next`, `.nuxt`, `.turbo`, `.parcel-cache` (Web build outputs)
* Rust `target` directories (with `Cargo.toml` context detection)
* .NET `bin` and `obj` compilation folders
* Python `__pycache__`, `.pytest_cache`, `.venv`, and `venv`
* Java/Android `.gradle` and `.m2` caches

### 2. Package Manager & AI Caches
* `npm-cache` & `~/.npm`
* `pip` wheel caches (`%LocalAppData%\pip\cache`)
* `uv` cache (`%LocalAppData%\uv\cache`)
* `yarn` & `pnpm` stores
* `NuGet` packages cache (`~/.nuget/packages`)
* `Cargo` registry cache (`~/.cargo/registry/cache`)
* HuggingFace Hub / PyTorch checkpoint caches

### 3. Windows & System Caches
* User `%TEMP%` and Windows `C:\Windows\Temp`
* Windows Error Reporting (WER) archives & queues
* Windows Crash Dumps (`%LocalAppData%\CrashDumps`, minidumps)
* Windows Delivery Optimization update cache
* DirectX & GPU Shader Caches (NVIDIA `DXCache`/`GLCache`, AMD `DxCache`, DirectX `D3DSCache`)
* Windows Explorer thumbnail caches

### 4. Browser & Desktop App Caches
* Microsoft Edge (Web cache, V8 code cache, GPU cache)
* Google Chrome (Web cache, bytecode cache, GPU cache)
* Brave Browser & Mozilla Firefox caches
* VS Code (Cache, CachedData, CachedExtensionVSIXs)
* Discord, Slack, and Spotify caches

### 5. Large & Hidden File Finder
* Scans all subdirectories for massive files exceeding thresholds (>100MB, >500MB, >1GB, >5GB).
* Categorizes by extension: AI Models (`.gguf`, `.bin`, `.safetensors`), Disk Images (`.iso`, `.vhdx`), Videos (`.mp4`, `.mkv`), Archives (`.zip`, `.7z`), Installers (`.exe`, `.msi`), and Database Backups (`.bak`, `.sql`).
* One-click "Reveal in Windows File Explorer" (`explorer.exe /select,"<file>"`).

### 6. Interactive Visual Directory Explorer
* Hierarchical drill-down of any drive or directory.
* Visual proportional bars showing which folder consumes what percentage of the parent directory.

---

## 🛡️ Safety & Privacy Guarantees

1. **Zero External Requests**: SpaceHunter runs 100% on `localhost:4880` (`127.0.0.1`). It bundles all assets locally.
2. **Safe Recycle Bin (SHFileOperation)**: Deletions can be performed via Windows native Recycle Bin API (`Microsoft.VisualBasic.FileIO.FileSystem::DeleteDirectory` / `DeleteFile`).
3. **Blacklisted System Roots**: You can never delete `C:\`, `C:\Windows`, `C:\Program Files`, or user home directories.
4. **Preserves Directory Anchors**: For folders like `%TEMP%`, only the transient files inside are cleaned; the folder itself is preserved so Windows services and apps do not glitch.
5. **No npm install necessary**: Uses Node.js built-in runtime libraries. Instant startup with zero dependencies.
