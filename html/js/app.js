$(function() {
  var restPath = '../scripts/metrics.js/';
  var trendURL = restPath + 'trend/json';

  function setNav(target) {
    $('.navbar .nav-item a[href="'+target+'"]').parent().addClass('active').siblings().removeClass('active');
    $(target).show().siblings().hide();
    window.sessionStorage.setItem('fabric_metrics_nav',target);
    window.history.replaceState(null,'',target);
  }

  var hash = window.location.hash;
  if(hash && $('.navbar .nav-item a[href="'+hash+'"]').length == 1) setNav(hash);
  else setNav(window.sessionStorage.getItem('fabric_metrics_nav') || $('.navbar .nav-item a').first().attr('href'));

  $('.navbar .nav-link').on('click', function(e) {
    var selected = $(this).attr('href');
    setNav(selected);
    if('#traffic' === selected || '#ports' === selected) $.event.trigger({type:'updateChart'}); 
  });

  $('a[href^="#"]').on('click', function(e) {
    e.preventDefault();
  });

  var colors = $.inmon.stripchart.prototype.options.colors;
  var SEP = '_SEP_';

  var db = {};

  $('#elephants-mice').chart({
    type: 'trend',
    metrics: ['elephant_bps','mice_bps'],
    stack:true,
    legend:['Elephants','Mice'],
    units: 'Bits per Second'},
  db);
  $('#busy-links').chart({
    type:'trend',
    stack:true,
    metrics:['busy_links_elephant','busy_links_mice','busy_links_collision'],
    legend:['Elephant','Mice','Collision'],
    units:'Number of Links'},
  db);
  $('#elephant-flows').chart({
    type: 'trend',
    metrics:['elephant_current'],
    stack:true,
    units: 'Number of Flows' },
  db);
  $('#elephant-arrivals').chart({
    type: 'trend',
    metrics:['elephant_arrivals','elephant_departures'],
    stack:false,
    legend: ['Arrivals','Departures'],
    colors: [colors[3],colors[4]],
    units: 'Flows per Second' },
  db);
  $('#discards').chart( {
    type:'trend',
    metrics:['discards'],
    legend:['Discards'],
    units:'Packets per Second'},
  db);      
  $('#errors').chart( {
    type:'trend',
    metrics:['errors'],
    legend:['Errors'],
    units:'Packets per Second'},
  db);
  $('#utilizationin').chart({
    type: 'topn',
    metric: 'top-5-inutilization',
    legendHeadings:['Switch','Ingress Port'],
    stack: false,
    includeOther:false,
    sep: SEP,
    units: '% Utilization'},
  db);
  $('#utilizationout').chart({
    type: 'topn',
    metric: 'top-5-oututilization',
    legendHeadings:['Switch','Egress Port'],
    stack: false,
    includeOther:false,
    sep: SEP,
    units: '% Utilization'},
  db);
  $('#discardsin').chart({
    type: 'topn',
    metric: 'top-5-indiscards',
    legendHeadings:['Switch','Ingress Port'],
    stack: false,
    includeOther:false,
    sep: SEP,
    units: 'Frames per Second'},
  db);
  $('#discardsout').chart({
    type: 'topn',
    metric: 'top-5-outdiscards',
    legendHeadings:['Switch','Egress Port'],
    stack: false,
    includeOther:false,
    sep: SEP,
    units: 'Frames per Second'},
  db);
  $('#errorsin').chart({
    type: 'topn',
    metric: 'top-5-inerrors',
    legendHeadings:['Switch','Ingress Port'],
    stack: false,
    includeOther:false,
    sep: SEP,
    units: 'Frames per Second'},
  db);
  $('#errorsout').chart({
    type: 'topn',
    metric: 'top-5-outerrors',
    legendHeadings:['Switch','Egress Port'],
    stack: false,
    includeOther:false,
    sep: SEP,
    units: 'Frames per Second'},
  db);

  function updateData(data) {
    if(!data 
      || !data.trend 
      || !data.trend.times 
      || data.trend.times.length == 0) return;
    
    if(db.trend) {
      // merge in new data
      var maxPoints = db.trend.maxPoints;
      db.trend.times = db.trend.times.concat(data.trend.times);
      var remove = db.trend.times.length > maxPoints ? db.trend.times.length - maxPoints : 0;
      if(remove) db.trend.times = db.trend.times.slice(remove);
      for(var name in db.trend.trends) {
        db.trend.trends[name] = db.trend.trends[name].concat(data.trend.trends[name]);
        if(remove) db.trend.trends[name] = db.trend.trends[name].slice(remove);
      }
    } else db.trend = data.trend;
    
    db.trend.start = new Date(db.trend.times[0]);
    db.trend.end = new Date(db.trend.times[db.trend.times.length - 1]);
    db.trend.values = data.trend.values;

    $.event.trigger({type:'updateChart'});
  }

  (function pollTrends() {
    $.ajax({
      url: trendURL,
      dataType: 'json',
      data: db.trend && db.trend.end ? {after:db.trend.end.getTime()} : null,
      success: function(data) {
        if(data) {
          updateData(data);
        } 
      },
      complete: function(result,status,errorThrown) {
        setTimeout(pollTrends,1000);
      },
      timeout: 60000
    });
  })();

  $(window).resize(function() {
    $.event.trigger({type:'updateChart'});
  });
});
