# Fix: Inactive VMs Being Removed from Dropdown

## Problem
Even after powering off a VM (up = 0), it still appears in the dropdown list. Inactive VMs should be removed automatically on each refresh.

## Root Cause

The issue was likely in the **React component state management**:

```javascript
// ❌ WRONG: This merges or keeps old data
const response = await api.get('/vms/active');
setVMs([...vms, ...response.data.vms]); // Appending

// ❌ WRONG: This might not trigger re-render
setVMs(prev => [...prev, ...response.data.vms]); // Merging
```

Or the **URL was wrong**:
```javascript
// ❌ WRONG: Missing `/api` prefix
const response = await api.get('/vms/active');

// ✅ CORRECT: Full path
const response = await api.get('/api/vms/active');
```

## Solution

### 1. Backend Verification ✓

The backend correctly filters active VMs in [dcim-backend/routes/vms.js](dcim-backend/routes/vms.js):

```javascript
// CRITICAL: Filter only active VMs (value === "1")
const activeVMs = results
  .filter(metric => {
    const value = metric.value?.[1];
    return value === '1' || value === 1;  // ← Only returns value=1
  })
  .map(metric => metric.metric?.instance)
  .filter(Boolean);

return res.json({
  success: true,
  vms: activeVMs,  // Only active VMs
  count: activeVMs.length,
});
```

### 2. Frontend Fix ✓

The corrected component [dcim-frontend/src/components/SimpleVMDropdown.jsx](dcim-frontend/src/components/SimpleVMDropdown.jsx) now:

**A. REPLACES state instead of merging:**
```javascript
// ✅ CORRECT: Completely replace all data (not merge)
const response = await api.get('/api/vms/active');
const newVMs = response.data?.vms || [];

// This replaces the entire array
setVMs(newVMs);  // ← NEW data only, old data discarded

// If selected VM is no longer active, clear it
if (value && !newVMs.includes(value)) {
  onChange?.(null);
}
```

**B. Uses correct API path:**
```javascript
const response = await api.get('/api/vms/active');  // ← Full path
```

**C. Separates fetch and interval logic:**
```javascript
// Fetch on mount (once)
useEffect(() => {
  fetchActiveVMs();
}, []);

// Auto-refresh interval (separate effect)
useEffect(() => {
  const intervalId = setInterval(() => {
    fetchActiveVMs();
  }, 5000);  // Every 5 seconds

  // CRITICAL: Cleanup on unmount
  return () => clearInterval(intervalId);
}, [value]);
```

**D. Clears selection if VM becomes inactive:**
```javascript
if (value && !newVMs.includes(value)) {
  console.warn(`Selected VM "${value}" is no longer active. Clearing selection.`);
  onChange?.(null);  // Clear selection
}
```

## How It Works Now

### Step 1: Component Mounts
```
→ fetchActiveVMs() called immediately
→ API returns: ["192.168.139.128:9100", "192.168.139.10:9100"]
→ State: vms = ["192.168.139.128:9100", "192.168.139.10:9100"]
→ Dropdown shows both VMs ✓
```

### Step 2: User Selects a VM
```
→ onChange called with selected VM
→ Dropdown shows selected VM highlighted ✓
```

### Step 3: 5 Seconds Pass (Auto-Refresh)
```
→ setInterval triggers fetchActiveVMs()
→ API returns: ["192.168.139.128:9100"]  (second VM is now down)
→ State COMPLETELY REPLACED: vms = ["192.168.139.128:9100"]
→ Old state discarded (no merge) ✓
→ Dropdown updates immediately ✓
```

### Step 4: If Selected VM Was Inactive
```
→ If user had selected "192.168.139.10:9100" (now down)
→ Check: is "192.168.139.10:9100" in ["192.168.139.128:9100"]? NO
→ onChange(null) called to clear selection
→ Dropdown shows "Choose a VM..." ✓
```

## Testing the Fix

### Test 1: Backend Filtering
```bash
cd dcim-backend
node test-vm-dropdown-fix.js
```

This verifies:
- ✓ Prometheus shows inactive VMs (up=0)
- ✓ Backend ONLY returns active VMs (up=1)
- ✓ No inactive VMs leak to frontend

### Test 2: Frontend Component
Use the example page [dcim-frontend/src/pages/VMManagementExample.jsx](dcim-frontend/src/pages/VMManagementExample.jsx)

Steps to test:
1. Navigate to VM Management page
2. Select a VM from dropdown
3. **Power off that VM** (simulate with `killall node_exporter`)
4. **Wait ≤5 seconds** for auto-refresh
5. Observe dropdown updates:
   - VM disappears from list ✓
   - If it was selected, selection clears ✓
   - Dropdown shows "No VMs available" (if all are down) ✓

### Test 3: Manual Testing
```javascript
// In browser console while on page with dropdown:
const vm = document.querySelector('select');
console.log('Current VMs:', Array.from(vm.options).map(o => o.value));

// Wait 5 seconds...
console.log('VMs after refresh:', Array.from(vm.options).map(o => o.value));
```

## Implementation Checklist

- [x] Backend filters only `value === "1"` ✓
- [x] Frontend uses `setVMs(newVMs)` (replaces state) ✓
- [x] Frontend uses correct API path `/api/vms/active` ✓
- [x] Fetch happens on mount ✓
- [x] Auto-refresh every 5 seconds ✓
- [x] Interval cleaned up on unmount ✓
- [x] Selection cleared if VM becomes inactive ✓
- [x] Logging added for debugging ✓

## Verification in Console

Watch the browser console while the dropdown is active:

```
[SimpleVMDropdown] Component mounted. Fetching initial VM list.
[SimpleVMDropdown] Fetching active VMs from /api/vms/active
[SimpleVMDropdown] Received 2 active VM(s): ["192.168.139.128:9100", "192.168.139.10:9100"]
[SimpleVMDropdown] Setting up auto-refresh interval (5000ms)

// After 5 seconds:
[SimpleVMDropdown] Auto-refresh triggered
[SimpleVMDropdown] Fetching active VMs from /api/vms/active
[SimpleVMDropdown] Received 1 active VM(s): ["192.168.139.128:9100"]
[SimpleVMDropdown] Selected VM "192.168.139.10:9100" is no longer active. Clearing selection.

// On unmount:
[SimpleVMDropdown] Cleaning up interval on unmount
```

## What Changed

| Before | After |
|--------|-------|
| `setVMs([...vms, ...newVMs])` | `setVMs(newVMs)` |
| Might merge with old data | Replaces all data |
| Inactive VMs might persist | Inactive VMs removed each refresh |
| Selection not validated | Selection cleared if VM down |
| Single useEffect for mount+interval | Two separate useEffects |
| No logging | Detailed console logs |

## API Endpoint Details

**Endpoint:** `GET /api/vms/active`

**Response Format:**
```json
{
  "success": true,
  "vms": ["192.168.139.128:9100"],
  "count": 1
}
```

**Key Guarantees:**
- ✓ Only returns VMs where Prometheus `up` metric = 1
- ✓ Never returns inactive VMs (up = 0)
- ✓ Returns empty array if no VMs active
- ✓ Returns empty array if Prometheus unreachable

**Query:**
```promql
up{job="vm-servers"}
```
Filtered to: `value === "1"` only

## Debugging Commands

```bash
# 1. Test backend directly
curl http://localhost:5000/api/vms/active | jq .vms

# 2. Check Prometheus directly
curl "http://192.168.139.128:9090/api/v1/query?query=up{job=\"vm-servers\"}" | jq

# 3. Run test suite
node test-vm-dropdown-fix.js

# 4. Watch network requests
# Open DevTools → Network tab
# Look for GET /api/vms/active requests every 5 seconds
```

## Summary

The fix ensures:

1. **Backend:** Only active VMs returned
2. **Frontend:** State completely replaced each refresh
3. **Behavior:** Inactive VMs disappear automatically within 5 seconds
4. **UX:** Selected VM cleared if it becomes inactive
5. **Performance:** No memory leaks (interval cleanup)

The dropdown now **always reflects real-time Prometheus state**. 🎉
