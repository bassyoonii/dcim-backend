const express = require('express');
const router = express.Router();
const Datacenter = require('../models/Datacenter');
const Rack = require('../models/Rack');
const Server = require('../models/Server');
const Switch = require('../models/Switch');
const StorageBay = require('../models/StorageBay');
const DataDomain = require('../models/DataDomain');
const Firewall = require('../models/Firewall');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { successResponse, errorResponse } = require('../utils/apiResponse');

router.use(protect, authorize('admin', 'net_operator'));

const toCsv = (rows) => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  });
  return lines.join('\n');
};

const buildCapacityRows = async () => {
  const [datacenters, racks, storage, dataDomains] = await Promise.all([
    Datacenter.find().select('name code').lean(),
    Rack.find().select('datacenter totalU occupiedU maxPowerConsumption currentPowerConsumption').lean(),
    StorageBay.find().select('datacenter totalCapacityTB allocatedCapacityTB').lean(),
    DataDomain.find().select('datacenter totalCapacityTB usedCapacityTB').lean(),
  ]);

  return datacenters.map((dc) => {
    const dcRacks = racks.filter((r) => String(r.datacenter) === String(dc._id));
    const dcStorage = storage.filter((s) => String(s.datacenter) === String(dc._id));
    const dcDataDomains = dataDomains.filter((d) => String(d.datacenter) === String(dc._id));

    const totalU = dcRacks.reduce((sum, r) => sum + (r.totalU || 0), 0);
    const occupiedU = dcRacks.reduce((sum, r) => sum + (r.occupiedU || 0), 0);

    const storageTotalTB = dcStorage.reduce((sum, s) => sum + (s.totalCapacityTB || 0), 0);
    const storageAllocatedTB = dcStorage.reduce((sum, s) => sum + (s.allocatedCapacityTB || 0), 0);

    const ddTotalTB = dcDataDomains.reduce((sum, d) => sum + (d.totalCapacityTB || 0), 0);
    const ddUsedTB = dcDataDomains.reduce((sum, d) => sum + (d.usedCapacityTB || 0), 0);

    const maxPowerW = dcRacks.reduce((sum, r) => sum + (r.maxPowerConsumption || 0), 0);
    const currentPowerW = dcRacks.reduce((sum, r) => sum + (r.currentPowerConsumption || 0), 0);

    return {
      datacenterCode: dc.code || '',
      datacenterName: dc.name || '',
      rackCount: dcRacks.length,
      totalU,
      occupiedU,
      freeU: Math.max(totalU - occupiedU, 0),
      occupancyPct: totalU ? ((occupiedU / totalU) * 100).toFixed(2) : '0.00',
      storageTotalTB,
      storageAllocatedTB,
      storageFreeTB: Math.max(storageTotalTB - storageAllocatedTB, 0),
      dataDomainTotalTB: ddTotalTB,
      dataDomainUsedTB: ddUsedTB,
      dataDomainFreeTB: Math.max(ddTotalTB - ddUsedTB, 0),
      maxPowerW,
      currentPowerW,
      powerPct: maxPowerW ? ((currentPowerW / maxPowerW) * 100).toFixed(2) : '0.00',
    };
  });
};

router.get('/capacity', async (req, res) => {
  try {
    const format = (req.query.format || 'json').toLowerCase();
    const rows = await buildCapacityRows();

    if (format === 'json') {
      return successResponse(res, rows);
    }

    if (format === 'csv') {
      const csv = toCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="capacity-report.csv"');
      return res.status(200).send(csv);
    }

    if (format === 'excel' || format === 'xlsx') {
      let ExcelJS;
      try {
        ExcelJS = require('exceljs');
      } catch (e) {
        return errorResponse(res, 'Excel export requires exceljs dependency', 501);
      }

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Capacity');
      if (rows.length) {
        sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key, width: 22 }));
        sheet.addRows(rows);
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="capacity-report.xlsx"');
      await workbook.xlsx.write(res);
      return res.end();
    }

    if (format === 'pdf') {
      let PDFDocument;
      try {
        PDFDocument = require('pdfkit');
      } catch (e) {
        return errorResponse(res, 'PDF export requires pdfkit dependency', 501);
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="capacity-report.pdf"');

      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      doc.pipe(res);
      doc.fontSize(16).text('DCIM Capacity Report', { underline: true });
      doc.moveDown(0.8);

      rows.forEach((r) => {
        doc.fontSize(10).text(
          `${r.datacenterCode} - ${r.datacenterName} | racks:${r.rackCount} | U:${r.occupiedU}/${r.totalU} | storage:${r.storageAllocatedTB}/${r.storageTotalTB}TB | power:${r.currentPowerW}/${r.maxPowerW}W`
        );
      });

      doc.end();
      return;
    }

    return errorResponse(res, 'Unsupported format. Use csv, excel, or pdf', 400);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/energy', async (req, res) => {
  try {
    const rows = await Rack.aggregate([
      {
        $group: {
          _id: '$datacenter',
          rackCount: { $sum: 1 },
          maxPowerW: { $sum: '$maxPowerConsumption' },
          currentPowerW: { $sum: '$currentPowerConsumption' }
        }
      },
      {
        $lookup: {
          from: 'datacenters',
          localField: '_id',
          foreignField: '_id',
          as: 'datacenter'
        }
      },
      { $unwind: { path: '$datacenter', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          datacenterId: '$_id',
          datacenterCode: '$datacenter.code',
          datacenterName: '$datacenter.name',
          rackCount: 1,
          maxPowerW: 1,
          currentPowerW: 1,
          freePowerW: { $max: [{ $subtract: ['$maxPowerW', '$currentPowerW'] }, 0] },
          utilizationPct: {
            $cond: [{ $gt: ['$maxPowerW', 0] }, { $multiply: [{ $divide: ['$currentPowerW', '$maxPowerW'] }, 100] }, 0]
          }
        }
      },
      { $sort: { datacenterCode: 1, datacenterName: 1 } }
    ]);

    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/support-expiration', async (req, res) => {
  try {
    const withinDays = Number(req.query.withinDays || 180);
    const now = new Date();
    const cutoff = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

    const [servers, storage, dataDomains, switches, firewalls] = await Promise.all([
      Server.find({ supportExpiry: { $ne: null, $lte: cutoff } })
        .select('name supportExpiry serialNumber datacenter rack')
        .populate('datacenter', 'name code')
        .populate('rack', 'name')
        .lean(),
      StorageBay.find({ supportExpiry: { $ne: null, $lte: cutoff } })
        .select('name supportExpiry brand model datacenter rack')
        .populate('datacenter', 'name code')
        .populate('rack', 'name')
        .lean(),
      DataDomain.find({ supportExpiry: { $ne: null, $lte: cutoff } })
        .select('name supportExpiry model datacenter rack')
        .populate('datacenter', 'name code')
        .populate('rack', 'name')
        .lean(),
      Switch.find({ supportExpiry: { $ne: null, $lte: cutoff } })
        .select('name supportExpiry brand model datacenter rack')
        .populate('datacenter', 'name code')
        .populate('rack', 'name')
        .lean(),
      Firewall.find({ supportExpiry: { $ne: null, $lte: cutoff } })
        .select('name supportExpiry brand model role datacenter rack')
        .populate('datacenter', 'name code')
        .populate('rack', 'name')
        .lean(),
    ]);

    const toItem = (kind, item) => ({
      kind,
      id: item._id,
      name: item.name,
      supportExpiry: item.supportExpiry,
      datacenter: item.datacenter,
      rack: item.rack,
      daysRemaining: Math.ceil((new Date(item.supportExpiry).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    });

    const items = [
      ...servers.map((x) => toItem('Server', x)),
      ...storage.map((x) => toItem('StorageBay', x)),
      ...dataDomains.map((x) => toItem('DataDomain', x)),
      ...switches.map((x) => toItem('Switch', x)),
      ...firewalls.map((x) => toItem('Firewall', x)),
    ].sort((a, b) => new Date(a.supportExpiry) - new Date(b.supportExpiry));

    return successResponse(res, {
      withinDays,
      total: items.length,
      items
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/assets', async (req, res) => {
  try {
    const format = (req.query.format || 'json').toLowerCase();
    const { datacenterId, rackId, type } = req.query;

    const baseFilter = {
      ...(datacenterId ? { datacenter: datacenterId } : {}),
      ...(rackId ? { rack: rackId } : {})
    };

    const [servers, switches, storage, dataDomains, firewalls] = await Promise.all([
      Server.find(baseFilter).select('name role datacenter rack supportExpiry').populate('datacenter', 'name code').populate('rack', 'name').lean(),
      Switch.find(baseFilter).select('name type datacenter rack totalPorts usedPorts supportExpiry').populate('datacenter', 'name code').populate('rack', 'name').lean(),
      StorageBay.find(baseFilter).select('name storageType datacenter rack totalCapacityTB allocatedCapacityTB supportExpiry').populate('datacenter', 'name code').populate('rack', 'name').lean(),
      DataDomain.find(baseFilter).select('name type datacenter rack totalCapacityTB usedCapacityTB supportExpiry').populate('datacenter', 'name code').populate('rack', 'name').lean(),
      Firewall.find(baseFilter).select('name role datacenter rack supportExpiry').populate('datacenter', 'name code').populate('rack', 'name').lean(),
    ]);

    const rows = [
      ...servers.map((x) => ({ kind: 'Server', name: x.name, subtype: x.role || '', datacenter: x.datacenter?.name || '', rack: x.rack?.name || '', capacity: '', used: '', supportExpiry: x.supportExpiry || '' })),
      ...switches.map((x) => ({ kind: 'Switch', name: x.name, subtype: x.type || '', datacenter: x.datacenter?.name || '', rack: x.rack?.name || '', capacity: x.totalPorts || 0, used: x.usedPorts || 0, supportExpiry: x.supportExpiry || '' })),
      ...storage.map((x) => ({ kind: 'StorageBay', name: x.name, subtype: x.storageType || '', datacenter: x.datacenter?.name || '', rack: x.rack?.name || '', capacity: x.totalCapacityTB || 0, used: x.allocatedCapacityTB || 0, supportExpiry: x.supportExpiry || '' })),
      ...dataDomains.map((x) => ({ kind: 'DataDomain', name: x.name, subtype: x.type || '', datacenter: x.datacenter?.name || '', rack: x.rack?.name || '', capacity: x.totalCapacityTB || 0, used: x.usedCapacityTB || 0, supportExpiry: x.supportExpiry || '' })),
      ...firewalls.map((x) => ({ kind: 'Firewall', name: x.name, subtype: x.role || '', datacenter: x.datacenter?.name || '', rack: x.rack?.name || '', capacity: '', used: '', supportExpiry: x.supportExpiry || '' })),
    ].filter((row) => {
      if (type && row.kind.toLowerCase() !== String(type).toLowerCase()) return false;
      return true;
    });

    if (format === 'json') {
      return successResponse(res, { servers, switches, storage, dataDomains, firewalls, rows });
    }

    if (format === 'csv') {
      const csv = toCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="assets-report.csv"');
      return res.status(200).send(csv);
    }

    if (format === 'excel' || format === 'xlsx') {
      let ExcelJS;
      try {
        ExcelJS = require('exceljs');
      } catch (e) {
        return errorResponse(res, 'Excel export requires exceljs dependency', 501);
      }

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Assets');
      if (rows.length) {
        sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key, width: 22 }));
        sheet.addRows(rows);
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="assets-report.xlsx"');
      await workbook.xlsx.write(res);
      return res.end();
    }

    if (format === 'pdf') {
      let PDFDocument;
      try {
        PDFDocument = require('pdfkit');
      } catch (e) {
        return errorResponse(res, 'PDF export requires pdfkit dependency', 501);
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="assets-report.pdf"');

      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      doc.pipe(res);
      doc.fontSize(16).text('DCIM Assets Report', { underline: true });
      doc.moveDown(0.8);
      rows.forEach((r) => {
        doc.fontSize(10).text(`${r.kind} | ${r.name} | ${r.datacenter}/${r.rack} | ${r.used}/${r.capacity}`);
      });
      doc.end();
      return;
    }

    return errorResponse(res, 'Unsupported format. Use json, csv, excel, or pdf', 400);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

module.exports = router;
