(function(global){

  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;
  const R_EARTH_KM = 6371;
  const AU_KM = 149597870.7;
  // Kecepatan cahaya dalam AU/hari (299792.458 km/s * 86400 s / AU_KM) -
  // dipakai buat koreksi waktu-cahaya posisi planet di planetLookAngles().
  const LIGHT_SPEED_AU_PER_DAY = 299792.458 * 86400 / AU_KM;

  function daysSinceJ2000(date){
    return (date.getTime() - Date.UTC(2000,0,1,12,0,0)) / 86400000;
  }

  function sunGeometry(date){
    const T = daysSinceJ2000(date) / 36525;
    const lambdaM = (280.460 + 36000.771 * T) % 360;
    const M = ((357.5291092 + 35999.05034 * T) % 360) * DEG2RAD;
    let lambdaEcl = lambdaM + 1.914666471 * Math.sin(M) + 0.019994643 * Math.sin(2*M);
    lambdaEcl = ((lambdaEcl % 360) + 360) % 360;
    const rAU = 1.000140612 - 0.016708617*Math.cos(M) - 0.000139589*Math.cos(2*M);
    const eps = 23.439291 - 0.0130042 * T;

    const lamRad = lambdaEcl * DEG2RAD;
    const epsRad = eps * DEG2RAD;
    const rKm = rAU * AU_KM;

    const x = rKm * Math.cos(lamRad);
    const y = rKm * Math.cos(epsRad) * Math.sin(lamRad);
    const z = rKm * Math.sin(epsRad) * Math.sin(lamRad);

    return { eci: {x,y,z}, lambdaEcl, eps };
  }

  function sunAltitudeDeg(date, obsLatDeg, obsLonDeg){
    return sunLookAngles(date, obsLatDeg, obsLonDeg).altitudeDeg;
  }

  function sunLookAngles(date, obsLatDeg, obsLonDeg){
    const { lambdaEcl, eps } = sunGeometry(date);
    const lamRad = lambdaEcl * DEG2RAD;
    const epsRad = eps * DEG2RAD;
    const ra = Math.atan2(Math.cos(epsRad)*Math.sin(lamRad), Math.cos(lamRad));
    const dec = Math.asin(Math.sin(epsRad)*Math.sin(lamRad));
    return raDecToLookAngles(ra, dec, date, obsLatDeg, obsLonDeg);
  }

  function isIlluminated(satEciKm, date){
    const sun = sunGeometry(date).eci;
    const sunMag = Math.sqrt(sun.x**2 + sun.y**2 + sun.z**2);
    const sunHat = { x: sun.x/sunMag, y: sun.y/sunMag, z: sun.z/sunMag };

    const dot = satEciKm.x*sunHat.x + satEciKm.y*sunHat.y + satEciKm.z*sunHat.z;
    if(dot >= 0) return true;

    const satMagSq = satEciKm.x**2 + satEciKm.y**2 + satEciKm.z**2;
    const perpSq = Math.max(0, satMagSq - dot*dot);
    return Math.sqrt(perpSq) >= R_EARTH_KM;
  }

  function propagateEci(satrec, date){
    const pv = global.satellite.propagate(satrec, date);
    if(!pv || !pv.position) return null;
    return pv.position;
  }

  function getSubsolarPoint(date){
    const sun = sunGeometry(date).eci;
    const gmst = global.satellite.gstime(date);
    const geo = global.satellite.eciToGeodetic(sun, gmst);
    return {
      lat: global.satellite.degreesLat(geo.latitude),
      lon: global.satellite.degreesLong(geo.longitude)
    };
  }

  function propagateGeodetic(satrec, date){
    const pv = global.satellite.propagate(satrec, date);
    if(!pv || !pv.position) return null;
    const gmst = global.satellite.gstime(date);
    const geo = global.satellite.eciToGeodetic(pv.position, gmst);
    const lat = global.satellite.degreesLat(geo.latitude);
    const lon = global.satellite.degreesLong(geo.longitude);
    const altKm = geo.height;
    let velKmh = null;
    if(pv.velocity){
      const v = pv.velocity;
      velKmh = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z) * 3600;
    }
    return { lat, lon, altKm, velKmh };
  }

  function computeOrbitHistory(satrec, fromDate, hoursBack=24, stepMinutes=2){
    const points = [];
    const totalSteps = Math.floor((hoursBack*60)/stepMinutes);
    for(let i=totalSteps; i>=0; i--){
      const t = new Date(fromDate.getTime() - i*stepMinutes*60000);
      const g = propagateGeodetic(satrec, t);
      if(g) points.push({ t, lat: g.lat, lon: g.lon, altKm: g.altKm, velKmh: g.velKmh });
    }
    return points;
  }

  function findNextIlluminationChange(satrec, fromDate, maxHours=6){
    const startEci = propagateEci(satrec, fromDate);
    if(!startEci) return null;
    const startState = isIlluminated(startEci, fromDate);

    const stepMs = 5000;
    const maxSteps = Math.ceil(maxHours*3600*1000/stepMs);
    let prevT = fromDate;
    for(let i=1;i<=maxSteps;i++){
      const t = new Date(fromDate.getTime() + i*stepMs);
      const eci = propagateEci(satrec, t);
      if(!eci) continue;
      const state = isIlluminated(eci, t);
      if(state !== startState){

        let lo = prevT.getTime(), hi = t.getTime();
        for(let b=0;b<10;b++){
          const mid = (lo+hi)/2;
          const midDate = new Date(mid);
          const midEci = propagateEci(satrec, midDate);
          const midState = isIlluminated(midEci, midDate);
          if(midState === startState) lo = mid; else hi = mid;
        }
        return { time: new Date(hi), fromIlluminated: startState, toIlluminated: state };
      }
      prevT = t;
    }
    return null;
  }

  async function findVisiblePasses(satrec, obsLatDeg, obsLonDeg, obsAltKm, opts){
    const options = Object.assign({
      days: 10,
      stepSec: 20,
      minElevationDeg: 10,
      maxSunAltDeg: -6,
      maxPasses: 6,
      startDate: new Date(),
      onProgress: null
    }, opts||{});

    const obsRad = {
      longitude: obsLonDeg * DEG2RAD,
      latitude: obsLatDeg * DEG2RAD,
      height: obsAltKm
    };

    const passes = [];
    const totalSteps = Math.floor(options.days*86400/options.stepSec);
    let current = null;
    let t = new Date(options.startDate);

    for(let i=0;i<totalSteps;i++){
      const eci = propagateEci(satrec, t);
      if(eci){
        const gmst = global.satellite.gstime(t);
        const ecf = global.satellite.eciToEcf(eci, gmst);
        const look = global.satellite.ecfToLookAngles(obsRad, ecf);
        const elevDeg = look.elevation * RAD2DEG;
        const illum = isIlluminated(eci, t);
        const sunAlt = sunAltitudeDeg(t, obsLatDeg, obsLonDeg);
        const visible = elevDeg >= options.minElevationDeg && illum && sunAlt <= options.maxSunAltDeg;

        if(visible && !current){
          current = { start: new Date(t), maxElevDeg: elevDeg, maxElevTime: new Date(t), maxAzRad: look.azimuth };
        } else if(visible && current){
          if(elevDeg > current.maxElevDeg){
            current.maxElevDeg = elevDeg;
            current.maxElevTime = new Date(t);
            current.maxAzRad = look.azimuth;
          }
        } else if(!visible && current){
          current.end = new Date(t);
          current.durationSec = (current.end - current.start)/1000;
          passes.push(current);
          current = null;
          if(passes.length >= options.maxPasses) break;
        }
      }

      t = new Date(t.getTime() + options.stepSec*1000);

      if(i % 400 === 0){
        if(options.onProgress) options.onProgress(i/totalSteps);
        await new Promise(r=>setTimeout(r,0));
      }
    }

    return passes;
  }

  function compassLabel(azRad){
    const dirs = (typeof I18N !== 'undefined')
      ? [I18N.t('js.dir.n'),I18N.t('js.dir.ne'),I18N.t('js.dir.e'),I18N.t('js.dir.se'),I18N.t('js.dir.s'),I18N.t('js.dir.sw'),I18N.t('js.dir.w'),I18N.t('js.dir.nw')]
      : ['Utara','Timur Laut','Timur','Tenggara','Selatan','Barat Daya','Barat','Barat Laut'];
    const deg = ((azRad*RAD2DEG)%360+360)%360;
    return dirs[Math.round(deg/45)%8];
  }

  function getLookAngles(satrec, obsLatDeg, obsLonDeg, obsAltKm, date){
    const eci = propagateEci(satrec, date);
    if(!eci) return null;
    const gmst = global.satellite.gstime(date);
    const ecf = global.satellite.eciToEcf(eci, gmst);
    const obsRad = { longitude: obsLonDeg*DEG2RAD, latitude: obsLatDeg*DEG2RAD, height: obsAltKm };
    const look = global.satellite.ecfToLookAngles(obsRad, ecf);
    return {
      azimuthDeg: ((look.azimuth*RAD2DEG)%360+360)%360,
      elevationDeg: look.elevation*RAD2DEG,
      rangeKm: look.rangeSat
    };
  }

  function normDeg(d){ return ((d % 360) + 360) % 360; }

  function solveKepler(Mrad, e){
    let E = Mrad;
    for(let i=0;i<8;i++){
      E = E - (E - e*Math.sin(E) - Mrad) / (1 - e*Math.cos(E));
    }
    return E;
  }

  const PLANET_ELEMENTS = {
    mercury: { a:[0.38709927,0.00000037],  e:[0.20563593,0.00001906],  I:[7.00497902,-0.00594749],  L:[252.25032350,149472.67411175], peri:[77.45779628,0.16047689],   node:[48.33076593,-0.12534081] },
    earth:   { a:[1.00000261,0.00000562],  e:[0.01671123,-0.00004392], I:[-0.00001531,-0.01294668], L:[100.46457166,35999.37244981], peri:[102.93768193,0.32327364],  node:[0,0] },
    venus:   { a:[0.72333566,0.00000390],  e:[0.00677672,-0.00004107], I:[3.39467605,-0.00078890],  L:[181.97909950,58517.81538729], peri:[131.60246718,0.00268329],  node:[76.67984255,-0.27769418] },
    mars:    { a:[1.52371034,0.00001847],  e:[0.09339410,0.00007882],  I:[1.84969142,-0.00813131],  L:[-4.55343205,19140.30268499],  peri:[-23.94362959,0.44441088], node:[49.55953891,-0.29257343] },
    jupiter: { a:[5.20288700,-0.00011607], e:[0.04838624,-0.00013253], I:[1.30439695,-0.00183714],  L:[34.39644051,3034.74612775],   peri:[14.72847983,0.21252668],  node:[100.47390909,0.20469106] },
    saturn:  { a:[9.53667594,-0.00125060], e:[0.05386179,-0.00050991], I:[2.48599187,0.00193609],   L:[49.95424423,1222.49362201],   peri:[92.59887831,-0.41897216], node:[113.66242448,-0.28867794] },
    uranus:  { a:[19.18916464,-0.00196176], e:[0.04725744,-0.00004397], I:[0.77263783,-0.00242939], L:[313.23810451,428.48202785],  peri:[170.95427630,0.40805281],  node:[74.01692503,0.04240589] },
    neptune: { a:[30.06992276,0.00026291],  e:[0.00859048,0.00005105],  I:[1.77004347,0.00035372],  L:[-55.12002969,218.45945325],  peri:[44.96476227,-0.32241464],  node:[131.78422574,-0.00508664] }
  };

  function planetHeliocentricEcliptic(key, T){
    const el = PLANET_ELEMENTS[key];
    const a = el.a[0] + el.a[1]*T;
    const e = el.e[0] + el.e[1]*T;
    const I = (el.I[0] + el.I[1]*T) * DEG2RAD;
    const L = el.L[0] + el.L[1]*T;
    const peri = el.peri[0] + el.peri[1]*T;
    const node = el.node[0] + el.node[1]*T;
    const argPeri = (peri - node) * DEG2RAD;
    const nodeRad = node * DEG2RAD;

    let M = normDeg(L - peri);
    if(M > 180) M -= 360;
    const E = solveKepler(M * DEG2RAD, e);

    const xp = a * (Math.cos(E) - e);
    const yp = a * Math.sqrt(1-e*e) * Math.sin(E);

    const cosO=Math.cos(nodeRad), sinO=Math.sin(nodeRad);
    const cosI=Math.cos(I), sinI=Math.sin(I);
    const cosW=Math.cos(argPeri), sinW=Math.sin(argPeri);

    return {
      x: (cosW*cosO - sinW*sinO*cosI)*xp + (-sinW*cosO - cosW*sinO*cosI)*yp,
      y: (cosW*sinO + sinW*cosO*cosI)*xp + (-sinW*sinO + cosW*cosO*cosI)*yp,
      z: (sinW*sinI)*xp + (cosW*sinI)*yp
    };
  }

  function raDecToLookAngles(raRad, decRad, date, obsLatDeg, obsLonDeg){
    const gst = global.satellite.gstime(date);
    const lst = gst + obsLonDeg * DEG2RAD;
    const H = lst - raRad;

    const latRad = obsLatDeg * DEG2RAD;
    const sinAlt = Math.sin(latRad)*Math.sin(decRad) + Math.cos(latRad)*Math.cos(decRad)*Math.cos(H);
    const altDeg = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD2DEG;

    const cosAz = (Math.sin(decRad) - Math.sin(latRad)*Math.sin(altDeg*DEG2RAD)) / (Math.cos(latRad)*Math.cos(altDeg*DEG2RAD));
    let azDeg = Math.acos(Math.max(-1, Math.min(1, cosAz))) * RAD2DEG;
    if(Math.sin(H) > 0) azDeg = 360 - azDeg;

    return { altitudeDeg: altDeg, azimuthDeg: normDeg(azDeg) };
  }

  function applyRefractionDeg(trueAltDeg){
    if(trueAltDeg < -1) return trueAltDeg;
    const h = Math.max(trueAltDeg, -1);
    const rArcmin = 1.02 / Math.tan((h + 10.3/(h+5.11)) * DEG2RAD);
    return trueAltDeg + rArcmin/60;
  }

  function precessJ2000ToDate(raRad, decRad, date){
    const T = daysSinceJ2000(date) / 36525;
    const ARCSEC2RAD = DEG2RAD / 3600;
    const zeta  = (2306.2181*T + 0.30188*T*T + 0.017998*T*T*T) * ARCSEC2RAD;
    const z     = (2306.2181*T + 1.09468*T*T + 0.018203*T*T*T) * ARCSEC2RAD;
    const theta = (2004.3109*T - 0.42665*T*T - 0.041833*T*T*T) * ARCSEC2RAD;

    const cosDec = Math.cos(decRad), sinDec = Math.sin(decRad);
    const cosRaZeta = Math.cos(raRad + zeta), sinRaZeta = Math.sin(raRad + zeta);
    const A = cosDec * sinRaZeta;
    const B = Math.cos(theta)*cosDec*cosRaZeta - Math.sin(theta)*sinDec;
    const C = Math.sin(theta)*cosDec*cosRaZeta + Math.cos(theta)*sinDec;

    const raDate = normDeg((Math.atan2(A, B) + z) * RAD2DEG) * DEG2RAD;
    const decDate = Math.asin(Math.max(-1, Math.min(1, C)));
    return { raRad: raDate, decRad: decDate };
  }

  function starLookAngles(raH, decDeg, date, obsLatDeg, obsLonDeg){
    const p = precessJ2000ToDate(raH * (Math.PI/12), decDeg * DEG2RAD, date);
    const look = raDecToLookAngles(p.raRad, p.decRad, date, obsLatDeg, obsLonDeg);
    return { azimuthDeg: look.azimuthDeg, altitudeDeg: applyRefractionDeg(look.altitudeDeg) };
  }

  // Versi "batch" ala Stellarium buat gambar ratusan bintang sekaligus tiap
  // frame. starLookAngles() di atas nyaman buat 1 target (autocalib dsb),
  // tapi kalau dipanggil di dalam loop ratusan bintang, dia bakal hitung
  // ulang sidereal time (gstime) & konstanta precession (zeta/z/theta) buat
  // TIAP bintang padahal semua itu cuma tergantung waktu+lokasi observer,
  // sama buat semua bintang di frame yang sama. Di sini semua yang
  // "per-frame" itu dihitung SEKALI di atas, terus tiap bintang tinggal
  // pakai aljabar murah (bukan panggil ulang trig-trig berat kayak gstime).
  // Hasilnya: dari 691 bintang, cuma 1x hitung sidereal time+precession
  // constant per frame, bukan 691x.
  function starLookAnglesBatch(stars, date, obsLatDeg, obsLonDeg){
    const gst = global.satellite.gstime(date);
    const lst = gst + obsLonDeg * DEG2RAD;
    const latRad = obsLatDeg * DEG2RAD;
    const sinLat = Math.sin(latRad), cosLat = Math.cos(latRad);

    const T = daysSinceJ2000(date) / 36525;
    const ARCSEC2RAD = DEG2RAD / 3600;
    const zeta  = (2306.2181*T + 0.30188*T*T + 0.017998*T*T*T) * ARCSEC2RAD;
    const z     = (2306.2181*T + 1.09468*T*T + 0.018203*T*T*T) * ARCSEC2RAD;
    const theta = (2004.3109*T - 0.42665*T*T - 0.041833*T*T*T) * ARCSEC2RAD;
    const cosTheta = Math.cos(theta), sinTheta = Math.sin(theta);

    const out = new Array(stars.length);
    for(let i=0;i<stars.length;i++){
      const star = stars[i];
      const raRad = star.raH * (Math.PI/12);
      const decRad = star.decDeg * DEG2RAD;

      // Precession J2000 -> tanggal sekarang, pakai zeta/z/theta yang udah
      // dihitung sekali di atas (bukan per bintang).
      const cosDec = Math.cos(decRad), sinDec = Math.sin(decRad);
      const cosRaZeta = Math.cos(raRad + zeta), sinRaZeta = Math.sin(raRad + zeta);
      const A = cosDec * sinRaZeta;
      const B = cosTheta*cosDec*cosRaZeta - sinTheta*sinDec;
      const C = sinTheta*cosDec*cosRaZeta + cosTheta*sinDec;
      const raDate = normDeg((Math.atan2(A, B) + z) * RAD2DEG) * DEG2RAD;
      const decDate = Math.asin(Math.max(-1, Math.min(1, C)));

      // Equatorial -> horizontal (alt/az), pakai lst/latRad yang udah
      // dihitung sekali di atas.
      const H = lst - raDate;
      const sinAlt = sinLat*Math.sin(decDate) + cosLat*Math.cos(decDate)*Math.cos(H);
      const altDeg = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD2DEG;
      const cosAz = (Math.sin(decDate) - sinLat*Math.sin(altDeg*DEG2RAD)) / (cosLat*Math.cos(altDeg*DEG2RAD));
      let azDeg = Math.acos(Math.max(-1, Math.min(1, cosAz))) * RAD2DEG;
      if(Math.sin(H) > 0) azDeg = 360 - azDeg;

      out[i] = {
        id: star.id,
        azimuthDeg: normDeg(azDeg),
        altitudeDeg: applyRefractionDeg(altDeg)
      };
    }
    return out;
  }

  function planetApparentMagnitude(key, rSunAU, deltaEarthAU, phaseAngleDeg){
    const base = 5 * Math.log10(rSunAU * deltaEarthAU);
    const i = phaseAngleDeg;
    switch(key){
      case 'mercury': return -0.42 + base + 0.0380*i - 0.000273*i*i + 0.000002*i*i*i;
      case 'venus':   return -4.40 + base + 0.0009*i + 0.000239*i*i - 0.00000065*i*i*i;
      case 'mars':    return -1.52 + base + 0.016*i;
      case 'jupiter': return -9.40 + base + 0.005*i;
      case 'saturn':  return -8.88 + base + 0.044*i;
      // Uranus & Neptunus: sudut fase dari Bumi selalu kecil (maks ~3° buat
      // Uranus, ~2° buat Neptunus) jadi efeknya ke magnitudo praktis
      // diabaikan (Karkoschka 2011 -> Uranus koefisien fase ~0.0028 mag/derajat,
      // Neptunus lebih kecil lagi dan gak dipakai). Konstanta dasar dari
      // Meeus, "Astronomical Algorithms" tabel 41.1.
      case 'uranus':  return -7.19 + base + 0.0028*i;
      case 'neptune': return -6.87 + base;
      default: return null;
    }
  }

  function planetLookAngles(key, date, obsLatDeg, obsLonDeg){
    const T = daysSinceJ2000(date) / 36525;
    const earth = planetHeliocentricEcliptic('earth', T);

    // Koreksi waktu-cahaya ("planetary aberration"): cahaya yang kita lihat
    // sekarang berangkat dari planet beberapa menit yang lalu (makin jauh
    // planetnya/makin cepat gerak relatifnya, makin besar selisihnya - buat
    // Mars misalnya bisa >10 menit cahaya). Iterasi: hitung jarak geometris
    // dulu, lalu hitung ulang posisi planet di waktu (t - jarak/c), ulangi
    // sampai konvergen (2x sudah lebih dari cukup karena Δtau antar-iterasi
    // sangat kecil).
    let planet = planetHeliocentricEcliptic(key, T);
    let xg = planet.x - earth.x, yg = planet.y - earth.y, zg = planet.z - earth.z;
    let deltaEarthAU = Math.sqrt(xg*xg + yg*yg + zg*zg);
    let tauDays = deltaEarthAU / LIGHT_SPEED_AU_PER_DAY;
    for(let i=0;i<2;i++){
      const Tp = T - tauDays/36525;
      planet = planetHeliocentricEcliptic(key, Tp);
      xg = planet.x - earth.x; yg = planet.y - earth.y; zg = planet.z - earth.z;
      deltaEarthAU = Math.sqrt(xg*xg + yg*yg + zg*zg);
      tauDays = deltaEarthAU / LIGHT_SPEED_AU_PER_DAY;
    }

    const eps = (23.439291 - 0.0130042*T) * DEG2RAD;
    const xeq = xg;
    const yeq = yg*Math.cos(eps) - zg*Math.sin(eps);
    const zeq = yg*Math.sin(eps) + zg*Math.cos(eps);

    const ra = Math.atan2(yeq, xeq);
    const dec = Math.asin(zeq/deltaEarthAU);

    const look = raDecToLookAngles(ra, dec, date, obsLatDeg, obsLonDeg);

    // Fase & magnitudo dihitung dari posisi geometris planet yang sudah
    // dikoreksi waktu-cahaya (rSunAU) - efek waktu-cahaya terhadap sudut
    // fase sendiri sangat kecil, tapi kita sudah punya nilainya gratis dari
    // iterasi di atas jadi sekalian dipakai.
    const rSunAU = Math.sqrt(planet.x*planet.x + planet.y*planet.y + planet.z*planet.z);
    const rSunEarthAU = Math.sqrt(earth.x*earth.x + earth.y*earth.y + earth.z*earth.z);
    let cosPhase = (rSunAU*rSunAU + deltaEarthAU*deltaEarthAU - rSunEarthAU*rSunEarthAU) / (2*rSunAU*deltaEarthAU);
    cosPhase = Math.max(-1, Math.min(1, cosPhase));
    const phaseAngleDeg = Math.acos(cosPhase) * RAD2DEG;
    const illumFraction = (1 + cosPhase) / 2;
    const magnitude = planetApparentMagnitude(key, rSunAU, deltaEarthAU, phaseAngleDeg);

    return Object.assign(look, {
      distanceAU: deltaEarthAU,
      distanceKm: deltaEarthAU * AU_KM,
      phaseAngleDeg,
      illumFraction,
      magnitude
    });
  }

  const MOON_MEAN_DISTANCE_KM = 384400;

  function applyLunarParallaxDeg(geocentricAltDeg, distanceKm){
    // The Moon is close enough that an observer standing on Earth's surface
    // sees it at a noticeably lower altitude than the geocentric (Earth-centre)
    // calculation gives - up to about 1 degree near the horizon. Every other
    // body we track (Sun, planets, stars) is far enough that this "horizontal
    // parallax" is negligible, but for the Moon it's large enough to push the
    // AR marker outside the camera's field of view or across the horizon line.
    const horizontalParallaxDeg = Math.asin(Math.min(1, R_EARTH_KM / distanceKm)) * RAD2DEG;
    return geocentricAltDeg - horizontalParallaxDeg * Math.cos(geocentricAltDeg * DEG2RAD);
  }

  function moonLookAngles(date, obsLatDeg, obsLonDeg){
    const T = daysSinceJ2000(date) / 36525;
    const Lp = normDeg(218.316 + 481267.881*T) * DEG2RAD;
    const M  = normDeg(134.963 + 477198.867*T) * DEG2RAD;
    const F  = normDeg(93.272  + 483202.017*T) * DEG2RAD;

    const lambda = Lp + (6.289*DEG2RAD)*Math.sin(M);
    const beta = (5.128*DEG2RAD)*Math.sin(F);

    const eps = (23.439291 - 0.0130042*T) * DEG2RAD;
    const ra = Math.atan2(Math.sin(lambda)*Math.cos(eps) - Math.tan(beta)*Math.sin(eps), Math.cos(lambda));
    const dec = Math.asin(Math.sin(beta)*Math.cos(eps) + Math.cos(beta)*Math.sin(eps)*Math.sin(lambda));

    const look = raDecToLookAngles(ra, dec, date, obsLatDeg, obsLonDeg);
    look.altitudeDeg = applyLunarParallaxDeg(look.altitudeDeg, MOON_MEAN_DISTANCE_KM);

    const sunLambda = sunGeometry(date).lambdaEcl * DEG2RAD;
    let elong = Math.abs(lambda - sunLambda);
    if(elong > Math.PI) elong = 2*Math.PI - elong;
    const illumFraction = (1 - Math.cos(elong)) / 2;

    return Object.assign(look, { illumFraction, distanceKm: MOON_MEAN_DISTANCE_KM, distanceIsAverage: true });
  }

  function getNightSkyBodies(obsLatDeg, obsLonDeg, obsAltKm, date){
    const bodies = [];
    const moon = moonLookAngles(date, obsLatDeg, obsLonDeg);
    bodies.push({
      key:'moon',
      azimuthDeg: moon.azimuthDeg,
      elevationDeg: moon.altitudeDeg,
      illumFraction: moon.illumFraction,
      distanceKm: moon.distanceKm,
      distanceIsAverage: true,
      magnitude: null
    });

    ['mercury','venus','mars','jupiter','saturn','uranus','neptune'].forEach(key=>{
      const look = planetLookAngles(key, date, obsLatDeg, obsLonDeg);
      bodies.push({
        key,
        azimuthDeg: look.azimuthDeg,
        elevationDeg: look.altitudeDeg,
        distanceAU: look.distanceAU,
        distanceKm: look.distanceKm,
        distanceIsAverage: false,
        phaseAngleDeg: look.phaseAngleDeg,
        illumFraction: look.illumFraction,
        magnitude: look.magnitude
      });
    });

    return bodies;
  }

  const SUN_ANGULAR_RADIUS_DEG = 0.2665;
  const MOON_ANGULAR_RADIUS_DEG = 0.259;
  const ISS_PHYSICAL_RADIUS_KM = 0.05;

  function angularSepDeg(az1Deg, el1Deg, az2Deg, el2Deg){
    const a1=az1Deg*DEG2RAD, e1=el1Deg*DEG2RAD, a2=az2Deg*DEG2RAD, e2=el2Deg*DEG2RAD;
    const cosD = Math.sin(e1)*Math.sin(e2) + Math.cos(e1)*Math.cos(e2)*Math.cos(a1-a2);
    return Math.acos(Math.max(-1, Math.min(1, cosD))) * RAD2DEG;
  }

  function targetLookAngles(target, date, obsLatDeg, obsLonDeg){
    return target === 'sun'
      ? sunLookAngles(date, obsLatDeg, obsLonDeg)
      : moonLookAngles(date, obsLatDeg, obsLonDeg);
  }

  function transitSepAt(satrec, obsLatDeg, obsLonDeg, obsAltKm, date, target){
    const issLook = getLookAngles(satrec, obsLatDeg, obsLonDeg, obsAltKm, date);
    if(!issLook) return null;
    const targetLook = targetLookAngles(target, date, obsLatDeg, obsLonDeg);
    const sep = angularSepDeg(issLook.azimuthDeg, issLook.elevationDeg, targetLook.azimuthDeg, targetLook.altitudeDeg);
    return { sep, issLook, targetLook };
  }

  function refineTransitApproach(satrec, obsLatDeg, obsLonDeg, obsAltKm, seedT, target, windowSec){
    let lo = seedT.getTime() - windowSec*1000;
    let hi = seedT.getTime() + windowSec*1000;
    const gr = (Math.sqrt(5)-1)/2;
    let c = hi - gr*(hi-lo);
    let d = lo + gr*(hi-lo);
    let fc = transitSepAt(satrec, obsLatDeg, obsLonDeg, obsAltKm, new Date(c), target).sep;
    let fd = transitSepAt(satrec, obsLatDeg, obsLonDeg, obsAltKm, new Date(d), target).sep;
    for(let k=0;k<28;k++){
      if(fc < fd){
        hi = d; d = c; fd = fc;
        c = hi - gr*(hi-lo);
        fc = transitSepAt(satrec, obsLatDeg, obsLonDeg, obsAltKm, new Date(c), target).sep;
      } else {
        lo = c; c = d; fc = fd;
        d = lo + gr*(hi-lo);
        fd = transitSepAt(satrec, obsLatDeg, obsLonDeg, obsAltKm, new Date(d), target).sep;
      }
    }
    const bestT = new Date(Math.round((lo+hi)/2));
    const info = transitSepAt(satrec, obsLatDeg, obsLonDeg, obsAltKm, bestT, target);
    if(!info) return null;

    const targetAngularRadiusDeg = target === 'sun' ? SUN_ANGULAR_RADIUS_DEG : MOON_ANGULAR_RADIUS_DEG;
    const issAngularRadiusDeg = Math.atan(ISS_PHYSICAL_RADIUS_KM / info.issLook.rangeKm) * RAD2DEG;
    const thresholdDeg = targetAngularRadiusDeg + issAngularRadiusDeg;

    return {
      time: bestT,
      target,
      sepDeg: info.sep,
      thresholdDeg,
      isTransit: info.sep <= thresholdDeg,
      issAzimuthDeg: info.issLook.azimuthDeg,
      issElevationDeg: info.issLook.elevationDeg,
      issRangeKm: info.issLook.rangeKm,
      targetAzimuthDeg: info.targetLook.azimuthDeg,
      targetElevationDeg: info.targetLook.altitudeDeg
    };
  }

  async function findIssTransits(satrec, obsLatDeg, obsLonDeg, obsAltKm, opts){
    const options = Object.assign({
      days: 10,
      coarseStepSec: 6,
      candidateThresholdDeg: 3,
      maxResults: 8,
      startDate: new Date(),
      onProgress: null
    }, opts||{});

    const hits = [];
    const totalSteps = Math.floor(options.days*86400/options.coarseStepSec);
    let t = new Date(options.startDate);

    for(let i=0;i<totalSteps;i++){
      const issLook = getLookAngles(satrec, obsLatDeg, obsLonDeg, obsAltKm, t);
      if(issLook && issLook.elevationDeg > 0){
        const sunLook = sunLookAngles(t, obsLatDeg, obsLonDeg);
        if(sunLook.altitudeDeg > -1){
          const sep = angularSepDeg(issLook.azimuthDeg, issLook.elevationDeg, sunLook.azimuthDeg, sunLook.altitudeDeg);
          if(sep < options.candidateThresholdDeg) hits.push({ t: new Date(t), target:'sun', sep });
        }
        const moonLook = moonLookAngles(t, obsLatDeg, obsLonDeg);
        if(moonLook.altitudeDeg > -1){
          const sep = angularSepDeg(issLook.azimuthDeg, issLook.elevationDeg, moonLook.azimuthDeg, moonLook.altitudeDeg);
          if(sep < options.candidateThresholdDeg) hits.push({ t: new Date(t), target:'moon', sep });
        }
      }

      t = new Date(t.getTime() + options.coarseStepSec*1000);

      if(i % 3000 === 0){
        if(options.onProgress) options.onProgress(i/totalSteps);
        await new Promise(r=>setTimeout(r,0));
      }
    }

    const clusters = [];
    let cur = null;
    hits.forEach(h=>{
      const gapOk = cur && cur.target === h.target &&
        (h.t.getTime() - cur.hits[cur.hits.length-1].t.getTime()) <= options.coarseStepSec*2000;
      if(gapOk){
        cur.hits.push(h);
      } else {
        if(cur) clusters.push(cur);
        cur = { target: h.target, hits: [h] };
      }
    });
    if(cur) clusters.push(cur);

    const events = clusters.map(c=>{
      let seed = c.hits[0];
      c.hits.forEach(h=>{ if(h.sep < seed.sep) seed = h; });
      return refineTransitApproach(satrec, obsLatDeg, obsLonDeg, obsAltKm, seed.t, c.target, options.coarseStepSec);
    }).filter(Boolean);

    events.sort((a,b)=>a.time-b.time);
    return events.slice(0, options.maxResults);
  }

  global.ISSAstro = {
    sunAltitudeDeg,
    sunLookAngles,
    getSubsolarPoint,
    isIlluminated,
    propagateEci,
    propagateGeodetic,
    computeOrbitHistory,
    findNextIlluminationChange,
    findVisiblePasses,
    findIssTransits,
    angularSepDeg,
    compassLabel,
    getLookAngles,
    raDecToLookAngles,
    planetLookAngles,
    moonLookAngles,
    getNightSkyBodies,
    applyRefractionDeg,
    precessJ2000ToDate,
    starLookAngles,
    starLookAnglesBatch,
    RAD2DEG, DEG2RAD
  };

})(window);
