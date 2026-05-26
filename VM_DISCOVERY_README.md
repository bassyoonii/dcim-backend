# VM Discovery Configuration Guide

## Overview

The VM discovery service automatically scans for active VMs in a subnet or predefined list, checks for node_exporter on port 9100, and generates a Prometheus file_sd_configs target file.

## Environment Variables

Add these to your `.env` file to configure VM discovery:

```env
# VM Discovery: Subnet (CIDR) or comma-separated IPs to scan
# Examples:
#   VM_DISCOVERY_SUBNET=192.168.139.0/24
#   VM_DISCOVERY_IPS=192.168.139.10,192.168.139.20,192.168.139.30
VM_DISCOVERY_SUBNET=192.168.139.0/24

# Port where node_exporter is running on VMs
NODE_EXPORTER_PORT=9100

# HTTP timeout for node_exporter checks (milliseconds)
VM_CHECK_TIMEOUT=2000

# Job name used in Prometheus labels
VM_JOB_NAME=vm-servers

# Discovery interval (milliseconds) - default 30 seconds
VM_DISCOVERY_INTERVAL=30000

# Concurrency for HTTP checks (default 20)
VM_CHECK_CONCURRENCY=20
```

## Output Format

The VM discovery service generates a Prometheus file_sd_configs file:

```json
[
  {
    "targets": ["192.168.139.10:9100", "192.168.139.20:9100"],
    "labels": { "job": "vm-servers" }
  }
]
```

### File Location

1. **Primary:** `/etc/prometheus/targets/vm.json`
2. **Fallback:** `./vm.json` (in project root)

The service will try to write to the primary location. If it fails (permission denied), it falls back to the local directory.

## How It Works

1. **Initialization:** On server startup, VM discovery starts immediately
2. **Periodic Scan:** Every 30 seconds (configurable), it:
   - Parses the configured subnet or IP list
   - Makes HTTP GET requests to `http://{IP}:9100/metrics`
   - Collects IPs where node_exporter responds (2xx status)
   - Generates and writes the Prometheus target file
   - Logs results to console

3. **Error Handling:**
   - Unreachable VMs are silently ignored
   - Network errors don't crash the service
   - Failures to write files are logged as warnings/errors

## Example Console Output

```
[vmDiscovery] Starting VM discovery...
[vmDiscovery] Scanning 256 IP(s)...
[vmDiscovery] Found 3 active VM(s): 192.168.139.10, 192.168.139.20, 192.168.139.30
[vmDiscovery] ✓ Written targets to /etc/prometheus/targets/vm.json
[vmDiscovery] ✓ Discovery completed in 4523ms
```

## Prometheus Configuration

Configure Prometheus to use the generated target file:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'vm-servers'
    file_sd_configs:
      - files:
          - '/etc/prometheus/targets/vm.json'
        refresh_interval: 10s
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
```

## Quick Start Example

```bash
# 1. Update your .env
cat >> .env << 'EOF'
VM_DISCOVERY_SUBNET=192.168.139.0/24
NODE_EXPORTER_PORT=9100
VM_DISCOVERY_INTERVAL=30000
EOF

# 2. Ensure node_exporter is running on target VMs
# (Outside scope of this guide)

# 3. Start the backend
npm run dev

# 4. Check logs for discovered VMs
# You should see output like:
#   [vmDiscovery] Found 3 active VM(s): 192.168.139.10, ...
#   [vmDiscovery] ✓ Written targets to ./vm.json

# 5. Verify the generated file
cat vm.json
```

## Advanced: Custom IP Lists

Instead of scanning a subnet, you can specify exact IPs:

```env
VM_DISCOVERY_IPS=192.168.139.10,192.168.139.20,192.168.139.50
```

## Debugging

Enable more verbose logging by checking server output:

```bash
# Run with environment-based debug
DEBUG=* npm run dev

# Or just watch the console for [vmDiscovery] logs
```

## Performance Considerations

- **Subnet /24:** ~256 IPs scanned, ~5-15 seconds with 2000ms timeout
- **Concurrency:** Set `VM_CHECK_CONCURRENCY` based on your network capacity (default: 20)
- **Timeout:** `VM_CHECK_TIMEOUT` should match your network latency + response time (default: 2000ms)
- **Interval:** `VM_DISCOVERY_INTERVAL` controls how often scanning runs (default: 30 seconds)

## Troubleshooting

### No VMs discovered

1. Check that node_exporter is running on target VMs on port 9100
2. Verify network connectivity: `curl http://192.168.139.10:9100/metrics`
3. Confirm the subnet/IPs in `VM_DISCOVERY_SUBNET` or `VM_DISCOVERY_IPS` are correct
4. Increase `VM_CHECK_TIMEOUT` if network is slow

### Permission denied writing to `/etc/prometheus/targets/`

The service will automatically fall back to `./vm.json` in the project root. Either:
- Run the backend with elevated privileges, or
- Configure Prometheus to read from `./vm.json`, or
- Create the directory and grant write permissions:
  ```bash
  sudo mkdir -p /etc/prometheus/targets
  sudo chmod 777 /etc/prometheus/targets
  ```

### VMs not appearing in Prometheus

1. Verify the `vm.json` file was created: `ls -la vm.json`
2. Check Prometheus config includes the file_sd_configs path
3. Restart Prometheus or trigger a reload
4. Check Prometheus UI → Status → Targets
