const Server = require('../models/Server');
const Switch = require('../models/Switch');
const StorageBay = require('../models/StorageBay');
const DataDomain = require('../models/DataDomain');
const Firewall = require('../models/Firewall');
const Vlan = require('../models/Vlan');
const Rack = require('../models/Rack');
const Datacenter = require('../models/Datacenter');
const NetworkPort = require('../models/NetworkPort');
const { successResponse, errorResponse } = require('../utils/apiResponse');

const toRegex = (value) => ({ $regex: value, $options: 'i' });

const parseNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
};

const toJsRegex = (value) => new RegExp(String(value), 'i');

// GET /api/search?q=<term>&ip=&vlan=&portNumber=&serialNumber=&networkTag=&datacenter=&rack=&type=
const globalSearch = async (req, res) => {
  try {
    const {
      q,
      ip,
      vlan,
      portNumber,
      serialNumber,
      networkTag,
      datacenter,
      rack,
      type
    } = req.query;

    const normalizedQ = (q || '').trim();
    const hasGlobalText = normalizedQ.length >= 2;
    const hasAdvancedFilters = [ip, vlan, portNumber, serialNumber, networkTag, datacenter, rack, type]
      .some((v) => v !== undefined && v !== null && String(v).trim() !== '');

    if (!hasGlobalText && !hasAdvancedFilters) {
      return errorResponse(res, 'Provide q (min 2 chars) or at least one advanced filter', 400);
    }

    const qRegex = hasGlobalText ? toRegex(normalizedQ) : null;
    const ipRegex = ip ? toRegex(String(ip).trim()) : null;
    const serialRegex = serialNumber ? toRegex(String(serialNumber).trim()) : null;
    const networkTagRegex = networkTag ? toRegex(String(networkTag).trim()) : null;
    const dcRegex = datacenter ? toRegex(String(datacenter).trim()) : null;
    const rackRegex = rack ? toRegex(String(rack).trim()) : null;
    const dcRegexJs = datacenter ? toJsRegex(datacenter) : null;
    const rackRegexJs = rack ? toJsRegex(rack) : null;
    const parsedVlan = parseNumber(vlan);
    const parsedPortNumber = parseNumber(portNumber);

    // Run all searches in parallel for speed
    const [servers, switches, storage, dataDomains, firewalls, vlans, racks, datacenters, ports] = await Promise.all([
      Server.find({
        $and: [
          hasGlobalText
            ? { $or: [{ name: qRegex }, { serialNumber: qRegex }, { 'idrac.ip': qRegex }] }
            : {},
          ipRegex ? { 'idrac.ip': ipRegex } : {},
          serialRegex ? { serialNumber: serialRegex } : {},
        ]
      })
        .select('name brand model rack datacenter serialNumber idrac role')
        .populate('rack', 'name')
        .populate('datacenter', 'name code')
        .limit(25),

      Switch.find({
        $and: [
          hasGlobalText ? { $or: [{ name: qRegex }, { brand: qRegex }, { model: qRegex }] } : {},
          type ? { type } : {},
        ]
      })
        .select('name brand model type rack datacenter')
        .populate('rack', 'name')
        .populate('datacenter', 'name code')
        .limit(25),

      StorageBay.find({
        $and: [
          hasGlobalText ? { $or: [{ name: qRegex }, { brand: qRegex }, { model: qRegex }] } : {},
          type ? { storageType: type } : {},
          networkTagRegex ? { networkConnections: networkTagRegex } : {},
        ]
      })
        .select('name brand model storageType rack datacenter networkConnections')
        .populate('rack', 'name')
        .populate('datacenter', 'name code')
        .limit(25),

      DataDomain.find({
        $and: [
          hasGlobalText ? { $or: [{ name: qRegex }, { model: qRegex }] } : {},
          type ? { type } : {},
          networkTagRegex ? { networkConnections: networkTagRegex } : {},
        ]
      })
        .select('name model type rack datacenter networkConnections')
        .populate('rack', 'name')
        .populate('datacenter', 'name code')
        .limit(25),

      Firewall.find({
        $and: [
          hasGlobalText ? { $or: [{ name: qRegex }, { brand: qRegex }, { model: qRegex }, { role: qRegex }] } : {},
          ipRegex ? { 'management.ip': ipRegex } : {},
        ]
      })
        .select('name brand model role rack datacenter management')
        .populate('rack', 'name')
        .populate('datacenter', 'name code')
        .limit(25),

      Vlan.find({
        $and: [
          hasGlobalText ? { $or: [{ name: qRegex }, { notes: qRegex }] } : {},
          parsedVlan !== undefined ? { vlanId: parsedVlan } : {},
        ]
      })
        .select('vlanId name network subnetMask gateway')
        .limit(25),

      Rack.find({
        $and: [
          hasGlobalText ? { name: qRegex } : {},
          rackRegex ? { name: rackRegex } : {},
        ]
      })
        .select('name datacenter totalU status')
        .populate('datacenter', 'name code')
        .limit(25),

      Datacenter.find({
        $and: [
          hasGlobalText ? { $or: [{ name: qRegex }, { code: qRegex }] } : {},
          dcRegex ? { $or: [{ name: dcRegex }, { code: dcRegex }] } : {},
        ]
      })
        .select('name code location')
        .limit(25),

      NetworkPort.find({
        $and: [
          hasGlobalText
            ? {
                $or: [
                  { ipAddress: qRegex },
                  { portNumber: qRegex },
                  { vlanTag: qRegex },
                  { networkCard: qRegex },
                ]
              }
            : {},
          ipRegex ? { ipAddress: ipRegex } : {},
          parsedVlan !== undefined ? { vlanId: parsedVlan } : {},
          parsedPortNumber !== undefined ? { portNumber: String(parsedPortNumber) } : {},
          networkTagRegex ? { $or: [{ vlanTag: networkTagRegex }, { networkCard: networkTagRegex }] } : {},
        ]
      })
        .select('portNumber ipAddress vlanId vlanTag switch status networkCard')
        .populate({
          path: 'switch',
          select: 'name rack datacenter',
          populate: [
            { path: 'rack', select: 'name' },
            { path: 'datacenter', select: 'name code' }
          ]
        })
        .limit(40)
    ]);

    const filteredPorts = ports.filter((p) => {
      if (dcRegexJs && !dcRegexJs.test(String(p.switch?.datacenter?.name || p.switch?.datacenter?.code || ''))) return false;
      if (rackRegexJs && !rackRegexJs.test(String(p.switch?.rack?.name || ''))) return false;
      return true;
    });

    return successResponse(res, {
      servers,
      switches,
      storage,
      dataDomains,
      firewalls,
      vlans,
      racks,
      datacenters,
      ports: filteredPorts,
      filters: {
        q: normalizedQ || null,
        ip: ip || null,
        vlan: parsedVlan ?? null,
        portNumber: parsedPortNumber ?? null,
        serialNumber: serialNumber || null,
        networkTag: networkTag || null,
        datacenter: datacenter || null,
        rack: rack || null,
        type: type || null
      },
            total: servers.length + switches.length + storage.length + dataDomains.length +
              firewalls.length + vlans.length + racks.length + datacenters.length + filteredPorts.length
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

module.exports = { globalSearch };