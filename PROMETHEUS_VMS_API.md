# Prometheus Active VMs API

This feature provides a backend endpoint that queries Prometheus to fetch **only active VMs** from the `up{job="vm-servers"}` metric. This is useful for creating dropdown lists or status dashboards that only show online VMs.

## Backend Endpoints

### 1. GET `/api/vms/active`

Fetch **only active VMs** (where `up = 1`)

**Request:**
```bash
curl http://localhost:5000/api/vms/active
```

**Response:**
```json
{
  "success": true,
  "vms": ["192.168.139.128:9100", "192.168.139.10:9100"],
  "count": 2
}
```

**Error Response (Prometheus unreachable):**
```json
{
  "success": false,
  "message": "Prometheus is unreachable",
  "error": "connect ECONNREFUSED 192.168.139.128:9090",
  "vms": []
}
```

### 2. GET `/api/vms`

Fetch **all VMs** with their status (active/inactive)

**Request:**
```bash
curl http://localhost:5000/api/vms
```

**Response:**
```json
{
  "success": true,
  "vms": [
    { "instance": "192.168.139.128:9100", "up": true, "value": 1 },
    { "instance": "192.168.139.10:9100", "up": false, "value": 0 }
  ],
  "count": 2,
  "activeCount": 1
}
```

### 3. GET `/api/vms/status?instance=<instance>`

Check the status of a specific VM

**Request:**
```bash
curl "http://localhost:5000/api/vms/status?instance=192.168.139.128:9100"
```

**Response:**
```json
{
  "success": true,
  "instance": "192.168.139.128:9100",
  "up": true,
  "value": 1
}
```

## Frontend Usage

### Using the API directly

```javascript
import { getActiveVMs, getAllVMs, getVMStatus } from '@/api/vmAPI';

// Get only active VMs
const activeVMs = await getActiveVMs();
// Returns: ["192.168.139.128:9100", "192.168.139.10:9100"]

// Get all VMs with status
const allVMs = await getAllVMs();
// Returns: [
//   { instance: "192.168.139.128:9100", up: true, value: 1 },
//   { instance: "192.168.139.10:9100", up: false, value: 0 }
// ]

// Check status of specific VM
const status = await getVMStatus('192.168.139.128:9100');
// Returns: { instance: "...", up: true, value: 1 }
```

### Using the React Hooks

Three custom hooks are available for easy integration:

#### `useActiveVMs()`

Fetch and display only active VMs

```javascript
import { useActiveVMs } from '@/hooks/useVMs';

function MyComponent() {
  const { vms, loading, error, refetch } = useActiveVMs();

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <select>
      {vms.map(vm => <option key={vm}>{vm}</option>)}
    </select>
  );
}
```

#### `useAllVMs(autoFetch, refreshInterval)`

Fetch all VMs with status and optional auto-refresh

```javascript
import { useAllVMs } from '@/hooks/useVMs';

function VMStatusDashboard() {
  // Auto-fetch on mount, refresh every 10 seconds
  const { vms, loading, error } = useAllVMs(true, 10000);

  return (
    <div>
      {vms.map(vm => (
        <div key={vm.instance}>
          {vm.instance}: {vm.up ? '✓ Active' : '✗ Down'}
        </div>
      ))}
    </div>
  );
}
```

#### `useVMStatus(instance, autoFetch, refreshInterval)`

Monitor a specific VM status with optional auto-refresh

```javascript
import { useVMStatus } from '@/hooks/useVMs';

function SingleVMMonitor({ instance }) {
  // Monitor specific VM, refresh every 5 seconds
  const { up, loading, error } = useVMStatus(instance, true, 5000);

  return up ? (
    <span className="text-green-500">✓ Active</span>
  ) : (
    <span className="text-red-500">✗ Down</span>
  );
}
```

### Using Pre-built Components

Ready-to-use components are available:

```javascript
import {
  ActiveVMsDropdown,
  VMStatusList,
  VMMonitoringDashboard,
} from '@/components/VMMonitoring';

// Simple dropdown of active VMs
<ActiveVMsDropdown 
  value={selectedVM} 
  onChange={setSelectedVM} 
/>

// List all VMs with status indicators
<VMStatusList />

// Complete dashboard with dropdown + list
<VMMonitoringDashboard />
```

## Example: VM Selection Form

```jsx
import { ActiveVMsDropdown } from '@/components/VMMonitoring';
import { useState } from 'react';

export function ServerForm() {
  const [vm, setVM] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!vm) {
      alert('Please select a VM');
      return;
    }
    // Do something with selected VM
    console.log('Selected VM:', vm);
  };

  return (
    <form onSubmit={handleSubmit}>
      <ActiveVMsDropdown value={vm} onChange={setVM} />
      <button type="submit" className="mt-4 rounded bg-blue-500 px-4 py-2 text-white">
        Continue
      </button>
    </form>
  );
}
```

## Example: Real-time VM Status Dashboard

```jsx
import { VMStatusList } from '@/components/VMMonitoring';

export function StatusPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">VM Status</h1>
      <VMStatusList /> {/* Auto-refreshes every 10 seconds */}
    </div>
  );
}
```

## Error Handling

All endpoints return appropriate HTTP status codes:

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Bad request (missing parameters) |
| 404 | Instance not found |
| 500 | Server error |
| 503 | Prometheus unreachable |
| 504 | Prometheus request timed out |

**Always return empty `vms` array on error** to prevent UI crashes:

```javascript
try {
  const vms = await getActiveVMs();
  // vms will be [] if error occurs
} catch (err) {
  console.error(err);
  // Endpoint already returned safe defaults
}
```

## Environment Setup

Ensure `PROMETHEUS_URL` is set in `.env`:

```env
PROMETHEUS_URL=http://192.168.139.128:9090
```

The endpoint automatically queries: `http://<PROMETHEUS_URL>/api/v1/query?query=up{job="vm-servers"}`

## Prometheus Query Details

The backend queries Prometheus with:

```promql
up{job="vm-servers"}
```

This assumes:
- Prometheus is scraping `node_exporter` instances
- Each exporter is labeled with `job="vm-servers"` (configurable via `VM_JOB_NAME` in .env)
- The `up` metric is available (default in Prometheus)

### Example Prometheus config:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'vm-servers'
    file_sd_configs:
      - files:
          - '/etc/prometheus/targets/vm.json'
```

And `vm.json` from VM discovery:

```json
[
  {
    "targets": ["192.168.139.128:9100", "192.168.139.10:9100"],
    "labels": { "job": "vm-servers" }
  }
]
```

## Performance & Caching

- **HTTP Timeout:** 5 seconds per request
- **No caching** on the backend (always queries Prometheus)
- **Frontend:** Use hooks' `refreshInterval` to control polling
- **Concurrency:** Safe; endpoints are not blocking

Example with controlled refresh:

```javascript
// Fetch once on component mount
const { vms } = useActiveVMs();

// Fetch once and never refresh
const { vms: allVMs } = useAllVMs(true, null);

// Fetch and auto-refresh every 30 seconds
const { vms: monitored } = useAllVMs(true, 30000);
```

## Troubleshooting

### "Prometheus is unreachable"

- Verify `PROMETHEUS_URL` in `.env`
- Check Prometheus is running: `curl http://<PROMETHEUS_URL>/api/v1/query?query=up`
- Verify network connectivity from backend to Prometheus

### No VMs returned

- Ensure `node_exporter` is running on target VMs on port 9100
- Verify Prometheus is scraping the `vm-servers` job
- Check Prometheus UI → Status → Targets for `vm-servers` job
- Run VM discovery or manually configure `vm.json` targets

### Dropdown shows "Choose a VM..." but no options

- Check network tab for `/api/vms/active` response
- Verify response has non-empty `vms` array
- Check browser console for errors

### Request takes too long

- Default timeout is 5 seconds
- Prometheus query might be slow if many VMs
- Check Prometheus performance: `curl http://<PROMETHEUS_URL>/api/v1/query?query=up{job="vm-servers"}`
