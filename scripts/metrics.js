// author: InMon Corp.
// version: 1.0
// date: 1/26/2021
// description: Fabric Metrics
// copyright: Copyright (c) 2021 InMon Corp. ALL RIGHTS RESERVED

include(scriptdir() + '/inc/trend.js');

var t = getSystemProperty('fabric-metrics.t') || 2;
var thresholdTimeout = getSystemProperty('fabric-metrics.threshold.timeout') || 1;
var thresholdElephant = getSystemProperty('fabric-metrics.threshold.elephant') || 10;
var thresholdUtilization = getSystemProperty('fabric-metrics.threshold.link') || 80;

var trend = new Trend(300,1);
var points = {};

var M = 1000000;
var G = 1000 * M;
var SEP = '_SEP_';

// what about VxLAN tunnel ?
setFlow('fm-flow', {
  keys: 'ipsource,ipdestination,ipprotocol,or:tcpsourceport:udpsourceport,or:tcpdestinationport:udpdestinationport',
  filter: 'first:stack:.:ip:ip6=ip&ipprotocol=6,17&direction=ingress',
  value: 'bytes',
  n: 10,
  t:t
});
setFlow('fm-flow6', {
  keys: 'ip6source,ip6destination,ip6nexthdr,or:tcpsourceport:udpsourceport,or:tcpdestinationport:udpdestinationport',
  filter: 'first:stack:.:ip:ip6=ip6&ip6nexthdr=6,17&direction=ingress',
  value: 'bytes',
  n: 10,
  t:t
});
setFlow('fm-bytes', {
  value:'bytes',
  t:t
});

var ifSpeeds = [1, 2.5, 5, 10, 25, 50, 100, 400];
var elephantSuffix = '-elephant';
var utilizationSuffix = '-utilization';
var thresholds = [];
function thresholdsForInterfaceSpeed(ifSpeed) {
  var name = 'fm-' + ifSpeed + 'G-4' + elephantSuffix;
  setThreshold(name, {
    metric:'fm-flow',
    value: ifSpeed * G * thresholdElephant * 0.01 / 8,
    byFlow:true, timeout:thresholdTimeout,
    filter:{ifspeed:[ifSpeed*G]}
  });
  thresholds.push(name);
  name = 'fm-' + ifSpeed + 'G-6' + elephantSuffix;
  setThreshold(name, {
    metric:'fm-flow6',
    value: ifSpeed * G * thresholdElephant * 0.01 / 8,
    byFlow:true, timeout:thresholdTimeout,
    filter:{ifspeed:[ifSpeed*G]}
  });
  thresholds.push(name);
  name = 'fm-' + ifSpeed + 'G' + utilizationSuffix; 
  setThreshold(name, {
    metric:'fm-bytes',
    value: ifSpeed * G * thresholdUtilization * 0.01 / 8,
    timeout:thresholdTimeout,
    filter:{ifspeed:[ifSpeed * G]}
  });
  thresholds.push(name);
}
ifSpeeds.forEach(function(ifSpeed) { thresholdsForInterfaceSpeed(ifSpeed); });

// moving average over last 100 flows
baselineCreate('duration',100,1,1);
baselineCreate('rate',100,1,1);

var elephants;
var elephantCounts = {};

var busyLinks;
var busyLinkCounts = {};

function resetCounts() {
  elephantCounts.arrivals = 0;
  elephantCounts.departures = 0;
  elephantCounts.bytes = 0;
  busyLinkCounts.elephant = 0;
  busyLinkCounts.collision = 0;
}
resetCounts();

function initializeElephants() {
  elephants = {};
  elephantCounts.current = 0;
}
initializeElephants();

function initializeBusyLinks() {
  busyLinks = {};
  busyLinkCounts.core = 0;
  busyLinkCounts.edge = 0;
}
initializeBusyLinks();

function elephantCount(agent, dataSource) {
  var linkflows, topKeys, i, count=0;
  linkflows = metric(agent,dataSource + '.fm-flow');
  if(linkflows && linkflows.length === 1) {
    topKeys = linkflows[0].topKeys;
    if(topKeys) {
      for(i = 0; i < topKeys.length; i++) {
        let el = elephants[topKeys[i].key];
        if(el && topKeys[i].value >= el.threshold) {
          count++;
        }
      }
    }
  }
  return count;
}

function elephantStart(flowKey, rec) {
  // place holder to mark elephant flows
}

function linkBusy(linkDs, linkRec, now) {
  // place holder to steer elephant flows
}

function elephantEnd(flowKey, rec) {
  // place holder to remove marking
}

setEventHandler(function(evt) {
  if(evt.thresholdID.endsWith(elephantSuffix)) {
    var rec = topologyInterfaceToLink(evt.agent,evt.dataSource);
    var isCore = rec && rec.linkname;
    if(isCore) return;

    var nodes = topologyNodesForAgent(evt.agent,evt.dataSource);
    if(!nodes || nodes.length !== 1) return;

    var links = topologyNodeLinks(nodes[0]);
    if(!links || links.length === 0) return; 

    rec = elephants[evt.flowKey];
    if(rec) return;

    rec = {
      start: evt.timestamp,
      bytes:evt.value,
      n:1,
      agent: evt.agent,
      dataSource: evt.dataSource,
      metric: evt.metric,
      thresholdID: evt.thresholdID,
      threshold:evt.threshold
    };
    elephants[evt.flowKey] = rec;
    elephantCounts.current++;
    elephantCounts.arrivals++;
    elephantStart(evt.flowKey, rec);
    return;   
  }
  if(evt.thresholdID.endsWith(utilizationSuffix)) {
    var rec = topologyInterfaceToLink(evt.agent,evt.dataSource);
    var isCore = rec && rec.linkname;
    if(!isCore) return;

    var linkDS = evt.agent + '.' + evt.dataSource;
    rec = busyLinks[linkDS];
    if(rec) return;

    rec = {
      start: evt.timestamp,
      agent:evt.agent,
      dataSource: evt.dataSource,
      metric: evt.metric,
      thresholdID: evt.thresholdID,
      threshold:evt.threshold
    };
    busyLinks[linkDS] = rec;
    busyLinkCounts.core++;
    linkBusy(linkDS, rec, evt.timestamp);
    return;
  }
}, thresholds);

function updateElephants(now) {
  var flowKey, rec, triggered, duration, bps, utilization, duration, val;
  for(flowKey in elephants) {
    rec = elephants[flowKey];
    triggered = thresholdTriggered(rec.thresholdID, rec.agent, rec.dataSource + '.' + rec.metric, flowKey);
    if(triggered) {
      val = flowValue(rec.agent, rec.dataSource + '.' + rec.metric, flowKey);
      rec.bytes += val;
      rec.n++;
      elephantCounts.bytes += val;
    }
    else {
      delete elephants[flowKey];
      duration = Math.round((now - rec.start) / 1000) - thresholdTimeout;
      if(duration < 1) duration = 1;
      // assume extra data points below threshold are small
      bps = (rec.bytes * 8) / duration;

      baselineCheck('duration',duration);
      baselineCheck('rate',bps);
            
      elephantCounts.current--;
      elephantCounts.departures++;
      elephantEnd(flowKey, rec);
    } 
  }
}

function updateBusyLinks(now) {
  var linkDS, rec, triggered, count;
  for(linkDS in busyLinks) {
    rec = busyLinks[linkDS];
    triggered = thresholdTriggered(rec.thresholdID, rec.agent, rec.dataSource + '.' + rec.metric);
    if(triggered) {
      count = elephantCount(rec.agent, rec.dataSource);
      if(count === 1) busyLinkCounts.elephant++;
      else if(count > 1) {
        busyLinkCounts.collision++;
        linkBusy(linkDS, rec, now);
      }
    }
    else {
      busyLinkCounts.core--;
      delete busyLinks[linkDS];
    }
  }
}

function getMetric(res, idx, defVal) {
  var val = defVal;
  if(res && res.length && res.length > idx && res[idx].hasOwnProperty('metricValue')) val = res[idx].metricValue;
  return val;
}

function calculateTopInterface(metric,n) {
  var top = table('TOPOLOGY','sort:'+metric+':-'+n) || [];
  var topN = {};
  for(var i = 0; i < top.length; i++) {
    var val = top[i][0];
    var port = topologyInterfaceToPort(val.agent,val.dataSource);
    if(port && port.node && port.port) {
      topN[port.node + SEP + port.port] = val.metricValue; 
    }
  }
  return topN; 
}

var metric_list = [
  'sum:ifindiscards',
  'sum:ifoutdiscards',
  'sum:ifinerrors',
  'sum:ifouterrors'
];

setIntervalHandler(function(now) {
  updateElephants(now);
  updateBusyLinks(now);

  points = {};

  var durationStats = baselineStatistics('duration');
  if(durationStats) points['elephant_flow_duration'] = durationStats.mean;
  else points['elephant_flow_duration'] = 0;

  var rateStats = baselineStatistics('rate');
  if(rateStats) points['elephant_flow_rate'] = rateStats.mean;
  else points['elephant_flow_rate'] = 0;
  
  points['elephant_current'] = elephantCounts.current;
  points['elephant_arrivals'] = elephantCounts.arrivals;
  points['elephant_departures'] = elephantCounts.departures;
  points['elephant_bps'] = elephantCounts.bytes * 8;

  var top = activeFlows('TOPOLOGY','fm-bytes',1,0,'edge');
  var edge_bps = top && top.length > 0 ? edge_bps = top[0].value * 8 : 0;
  points['edge_bps'] = edge_bps;;

  // mice = total - elephants
  // variance can result in negative value if values are close
  points['mice_bps'] = Math.max(0, points['edge_bps'] - points['elephant_bps']);

  points['busy_links_mice'] = Math.max(busyLinkCounts.core - busyLinkCounts.elephant - busyLinkCounts.collision, 0);
  points['busy_links_elephant'] = busyLinkCounts.elephant;
  points['busy_links_collision'] = busyLinkCounts.collision;

  var res = metric('TOPOLOGY',metric_list);
  points['discards'] = getMetric(res,0,0) + getMetric(res,1,0);
  points['errors'] = getMetric(res,2,0) + getMetric(res,3,0);

  points['top-5-indiscards'] = calculateTopInterface('ifindiscards',5);
  points['top-5-outdiscards'] = calculateTopInterface('ifoutdiscards',5);
  points['top-5-inerrors'] = calculateTopInterface('ifinerrors',5);
  points['top-5-outerrors'] = calculateTopInterface('ifouterrors',5);
  points['top-5-inutilization'] = calculateTopInterface('ifinutilization',5);
  points['top-5-oututilization'] = calculateTopInterface('ifoututilization',5);

  trend.addPoints(now,points);

  resetCounts();
},1);

const prometheus_prefix = (getSystemProperty("prometheus.metric.prefix") || 'sflow_') + 'fabric_metric_';

function prometheusName(str) {
  return str.replace(/[^a-zA-Z0-9_]/g,'_');
}

function prometheus() {
  var result = prometheus_prefix+'bps{type="elephant"} '+(points['elephant_bps'] || 0)+'\n'
  result += prometheus_prefix+'bps{type="mice"} '+(points['mice_bps'] || 0)+'\n';
  result += prometheus_prefix+'elephant_current '+(points['elephant_current'] || 0)+'\n';
  result += prometheus_prefix+'elephant_arrivals '+(points['elephant_arrivals'] || 0)+'\n';
  result += prometheus_prefix+'elephant_departures '+(points['elephant_departures'] || 0)+'\n';
  result += prometheus_prefix+'busy_links{traffic="mice"} '+(points['busy_links_mice'] || 0)+'\n';
  result += prometheus_prefix+'busy_links{traffic="elephant"} '+(points['busy_links_elephant'] || 0)+'\n';
  result += prometheus_prefix+'busy_links{traffic="collision"} '+(points['busy_links_collision'] || 0)+'\n';
  result += prometheus_prefix+'errors '+(points['errors'] || 0)+'\n';
  result += prometheus_prefix+'discards '+(points['discards'] || 0)+'\n';
  return result;
}

setHttpHandler(function(req) {
  var result, path = req.path;
  if(!path || path.length === 0) throw "not_found";
  if(path.length === 1 && 'txt' === req.format) {
    return prometheus();
  }
  if('json' !== req.format) throw "not_found";
  switch(path[0]) {
    case 'trend':
      if(path.length > 1) throw "not_found"; 
      result = {};
      result.trend = req.query.after ? trend.after(parseInt(req.query.after)) : trend;
      break;
    case 'metric':
      if(path.length === 1) result = points;
      else {
        if(path.length !== 2) throw "not_found";
        if(points.hasOwnProperty(path[1])) result = points[path[1]];
        else throw "not_found";
      }
      break;
    default: throw 'not_found';
  }
  return result;
});
