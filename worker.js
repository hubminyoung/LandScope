/**
 * LandScope v2.0 — Cloudflare Worker
 * https://siteanl.younrake.workers.dev
 *
 * 보안: 모든 API 키는 Cloudflare Secrets(환경변수)로 관리.
 * 클라이언트는 키를 전송하지 않음 — Worker가 서버사이드에서 주입.
 *
 * ── Secrets 설정 (Cloudflare 대시보드 → Workers & Pages → 해당 Worker
 *    → Settings → Variables & Secrets → "Add secret" 또는 wrangler CLI) ──
 *
 *   wrangler secret put VWORLD_KEY        # api.vworld.kr 키 (525DBFC7-...)
 *   wrangler secret put AIRKOREA_KEY      # 에어코리아 data.go.kr Decoding 키
 *   wrangler secret put KMA_KEY           # 기상청 data.go.kr Decoding 키
 *   wrangler secret put KMAHUB_KEY        # apihub.kma.go.kr 인증키
 *   wrangler secret put SOILRDA_KEY       # 흙토람 data.go.kr Decoding 키
 *   wrangler secret put NIBR_KEY          # 국립생물자원관 data.go.kr Decoding 키
 *   wrangler secret put ENVGRD_KEY        # 환경성평가 API 키 (YD6X-...)
 *   wrangler secret put FLOOD_KEY         # 홍수위험지도 API 키
 *   wrangler secret put ECOBANK_KEY       # 에코뱅크 API 키
 *   wrangler secret put GYEONGGI_KEY      # 경기도 공공데이터 키
 *   wrangler secret put SGIS_KEY          # 통계청 SGIS consumer_key
 *   wrangler secret put SGIS_SECRET       # 통계청 SGIS consumer_secret
 *   wrangler secret put GROUNDWATER_KEY   # 국가지하수정보시스템 키
 *   wrangler secret put SOILCONTAM_KEY    # 식품안전나라 토양오염도 코드 (5e37be4b...)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Access-Password',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ── 비밀번호 검증 (타일 라우트·keys-status 제외) ─────────────
    // ACCESS_PASSWORD 시크릿이 설정된 경우에만 검증.
    // 타일 라우트는 <img> 태그 경유(fetch 없음)라 헤더 전달 불가 → 스킵.
    {
      const TILE_ROUTES = ['/vworld-base/', '/vworld-satellite/', '/vworld-hybrid/', '/vworld-cadastral/'];
      const isTile = TILE_ROUTES.some(p => path.startsWith(p));
      if (!isTile && env.ACCESS_PASSWORD) {
        const clientPass = request.headers.get('X-Access-Password') || '';
        if (clientPass !== env.ACCESS_PASSWORD) {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }
    }

    // ── 헬퍼: 업스트림 응답을 CORS 헤더 포함해 반환 ──────────────
    const proxy = async (targetUrl, reqOptions = {}) => {
      const res = await fetch(targetUrl, reqOptions);
      const contentType = res.headers.get('Content-Type') || 'application/json';
      return new Response(res.body, {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': contentType }
      });
    };

    // ── 헬퍼: 키 없을 때 투명 1px GIF 반환 (타일 오류 억제) ──
    const emptyTile = (hdrs) => {
      const empty = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      return new Response(Uint8Array.from(atob(empty), c => c.charCodeAt(0)), {
        headers: { ...hdrs, 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }
      });
    };

    // ── 헬퍼: 쿼리스트링에서 특정 파라미터를 제거하고 env 값으로 교체 ──
    const injectQS = (search, paramName, value) => {
      const p = new URLSearchParams(search ? search.slice(1) : '');
      p.delete(paramName);
      if (value) p.set(paramName, value);
      return '?' + p.toString();
    };

    // ── 헬퍼: serviceKey 주입 (data.go.kr 계열 공통) ──────────────
    const injectServiceKey = (search, key) => injectQS(search, 'serviceKey', key);

    try {

      // ════════════════════════════════════════════════════════════════
      // 신규: 키 상태 조회 — 클라이언트 AVAIL 초기화용
      // ════════════════════════════════════════════════════════════════
      if (path === '/keys-status') {
        return new Response(JSON.stringify({
          vworld:      !!env.VWORLD_KEY,
          airkorea:    !!env.AIRKOREA_KEY,
          kma:         !!env.KMA_KEY,
          kmaHub:      !!env.KMAHUB_KEY,
          soilrda:     !!env.SOILRDA_KEY,
          nibr:        !!env.NIBR_KEY,
          envgrd:      !!env.ENVGRD_KEY,
          flood:       !!env.FLOOD_KEY,
          ecobank:     !!env.ECOBANK_KEY,
          gyeonggi:    !!env.GYEONGGI_KEY,
          sgis:        !!(env.SGIS_KEY && env.SGIS_SECRET),
          groundwater: !!env.GROUNDWATER_KEY,
          soilContam:  !!env.SOILCONTAM_KEY,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
      }

      // ════════════════════════════════════════════════════════════════
      // 신규: VWorld 주소 API (역지오코딩 + 좌표검색) — key 서버사이드 주입
      // ════════════════════════════════════════════════════════════════
      if (path === '/vworld-address') {
        const qs = injectQS(url.search, 'key', env.VWORLD_KEY);
        return proxy(`https://api.vworld.kr/req/address${qs}`);
      }

      // ════════════════════════════════════════════════════════════════
      // 신규: VWorld WMTS 지적편집도 타일 프록시 — key URL에 삽입
      // /vworld-cadastral/{z}/{y}/{x} → api.vworld.kr WMTS Cadastral
      // ════════════════════════════════════════════════════════════════
      if (path.startsWith('/vworld-cadastral/')) {
        if (!env.VWORLD_KEY) {
          // 키 없으면 투명 1px GIF 반환 (타일 오류 억제)
          const empty = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          return new Response(Uint8Array.from(atob(empty), c => c.charCodeAt(0)), {
            headers: { ...corsHeaders, 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }
          });
        }
        // path: /vworld-cadastral/z/y/x
        const parts = path.replace('/vworld-cadastral/', '').split('/');
        const [z, y, x] = parts;
        const tileUrl = `https://api.vworld.kr/req/wmts/1.0.0/${env.VWORLD_KEY}/Cadastral/default/GoogleMapsCompatible/${z}/${y}/${x}.png`;
        const res = await fetch(tileUrl);
        return new Response(res.body, {
          status: res.status,
          headers: { ...corsHeaders, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
        });
      }

      // VWorld Base (한글 지명 지도) WMTS — /vworld-base/{z}/{y}/{x}
      if (path.startsWith('/vworld-base/')) {
        if (!env.VWORLD_KEY) return emptyTile(corsHeaders);
        const [z,y,x] = path.replace('/vworld-base/','').split('/');
        const res = await fetch(`https://api.vworld.kr/req/wmts/1.0.0/${env.VWORLD_KEY}/Base/default/GoogleMapsCompatible/${z}/${y}/${x}.png`);
        return new Response(res.body, { status: res.status, headers: { ...corsHeaders, 'Content-Type':'image/png', 'Cache-Control':'public, max-age=86400' } });
      }

      // VWorld Hybrid (한글 지명 오버레이) WMTS — /vworld-hybrid/{z}/{y}/{x}
      if (path.startsWith('/vworld-hybrid/')) {
        if (!env.VWORLD_KEY) return emptyTile(corsHeaders);
        const [z,y,x] = path.replace('/vworld-hybrid/','').split('/');
        const res = await fetch(`https://api.vworld.kr/req/wmts/1.0.0/${env.VWORLD_KEY}/Hybrid/default/GoogleMapsCompatible/${z}/${y}/${x}.png`);
        return new Response(res.body, { status: res.status, headers: { ...corsHeaders, 'Content-Type':'image/png', 'Cache-Control':'public, max-age=86400' } });
      }

      // VWorld Satellite WMTS — /vworld-satellite/{z}/{y}/{x}
      if (path.startsWith('/vworld-satellite/')) {
        if (!env.VWORLD_KEY) return emptyTile(corsHeaders);
        const [z,y,x] = path.replace('/vworld-satellite/','').split('/');
        const res = await fetch(`https://api.vworld.kr/req/wmts/1.0.0/${env.VWORLD_KEY}/Satellite/default/GoogleMapsCompatible/${z}/${y}/${x}.jpeg`);
        return new Response(res.body, { status: res.status, headers: { ...corsHeaders, 'Content-Type':'image/jpeg', 'Cache-Control':'public, max-age=86400' } });
      }

      // ════════════════════════════════════════════════════════════════
      // 기존 라우트 — 키 서버사이드 주입으로 업그레이드
      // ════════════════════════════════════════════════════════════════

      // ── KMA 기상자료개방포털 (serviceKey 주입) ──
      if (path.startsWith('/kma/')) {
        const qs = injectServiceKey(url.search, env.KMA_KEY);
        return proxy(`https://apis.data.go.kr/1360000${path.replace('/kma', '')}${qs}`);
      }

      // ── 흙토람 V2 (주소 기반 폴백) ──
      if (path === '/soil-v2') {
        const qs = injectServiceKey(url.search, env.SOILRDA_KEY);
        return proxy(`https://apis.data.go.kr/1390802/SoilEnviron/SoilExam/getSoilExamList${qs}`);
      }

      // ── 흙토람 V3 (PNU 기반, 토양특성 27종) ──
      if (path === '/soil-v3') {
        const qs = injectServiceKey(url.search, env.SOILRDA_KEY);
        return proxy(`https://apis.data.go.kr/1390802/SoilEnviron/SoilCharac/V3/getSoilCharacter${qs}`);
      }

      // ── 에어코리아 ──
      if (path.startsWith('/airkorea/')) {
        const qs = injectServiceKey(url.search, env.AIRKOREA_KEY);
        return proxy(`https://apis.data.go.kr/B552584${path.replace('/airkorea', '')}${qs}`);
      }

      // ── 국가소음측정망 (환경부 B552584) ──
      if (path.startsWith('/noise')) {
        const qs = injectServiceKey(url.search, env.AIRKOREA_KEY);
        return proxy(`https://apis.data.go.kr/B552584/NoiseInfoInqireService${path.replace('/noise', '') || '/getNearbyNoiseInfo'}${qs}`);
      }

      // ── 국립생물자원관 NIBR ──
      if (path.startsWith('/nibr/')) {
        const qs = injectServiceKey(url.search, env.NIBR_KEY);
        return proxy(`https://apis.data.go.kr/1480523${path.replace('/nibr', '')}${qs}`);
      }

      // ── 생태자연도 (국립생태원 B553084) ──
      if (path.startsWith('/ecomap/')) {
        const qs = injectServiceKey(url.search, env.NIBR_KEY);
        return proxy(`https://apis.data.go.kr/B553084/ecoapi/EcologyzmpService${path.replace('/ecomap', '')}${qs}`);
      }

      // ── 전국버스정류장 (국토부 1613000) ──
      if (path.startsWith('/bus-stop')) {
        const qs = injectServiceKey(url.search, env.SOILRDA_KEY);
        return proxy(`https://apis.data.go.kr/1613000/BusSttnInfoInqireService${path.replace('/bus-stop', '') || '/getSttnByGps'}${qs}`);
      }

      // ── 홍수위험지도 WFS (국토부 floodmap.go.kr) ──
      if (path.startsWith('/floodmap-wfs')) {
        const qs = injectQS(url.search, 'apiKey', env.FLOOD_KEY);
        return proxy(`https://floodmap.go.kr/geoserver/wfs${qs}`);
      }

      // ── VWorld 데이터 API (PNU, 용도지역, 토지이용현황 등) — key 주입 ──
      if (path === '/vworld-data') {
        const qs = injectQS(url.search, 'key', env.VWORLD_KEY);
        const res = await fetch(`https://api.vworld.kr/req/data${qs}`);
        return new Response(res.body, {
          status: res.status,
          headers: { ...corsHeaders, 'Content-Type': res.headers.get('Content-Type') || 'application/json' }
        });
      }

      // ── VWorld WMS 타일 (지적편집도 WMS fallback) — KEY 주입 ──
      if (path.startsWith('/vworld-wms')) {
        const qs = injectQS(url.search, 'KEY', env.VWORLD_KEY);
        const res = await fetch(`https://api.vworld.kr/req/wms${qs}`);
        const contentType = res.headers.get('Content-Type') || 'image/png';
        return new Response(res.body, { status: res.status, headers: { ...corsHeaders, 'Content-Type': contentType } });
      }

      // ── VWorld DEM 래스터 (고도 조회) — key 주입 ──
      if (path.startsWith('/vworld-raster')) {
        const qs = injectQS(url.search, 'key', env.VWORLD_KEY);
        const res = await fetch(`https://api.vworld.kr/req/raster${qs}`);
        const contentType = res.headers.get('Content-Type') || 'application/json';
        return new Response(res.body, { status: res.status, headers: { ...corsHeaders, 'Content-Type': contentType } });
      }

      // ── VWorld NED WFS (토지이용계획·토지특성 WFS) — key 주입 ──
      if (path.startsWith('/vworld-ned-wfs')) {
        const subPath = path.replace('/vworld-ned-wfs', '') || '';
        const qs = injectQS(url.search, 'key', env.VWORLD_KEY);
        const res = await fetch(`https://api.vworld.kr/ned/wfs${subPath}${qs}`, {
          headers: { 'Accept': 'application/json, */*' }
        });
        const contentType = res.headers.get('Content-Type') || 'application/json';
        return new Response(res.body, { status: res.status, headers: { ...corsHeaders, 'Content-Type': contentType } });
      }

      // ── 경기도 공공데이터 — 보호종 현황 (KEY 주입) ──
      if (path.startsWith('/gg-protected-tree')) {
        const qs = injectQS(url.search, 'KEY', env.GYEONGGI_KEY);
        return proxy(`https://openapi.gg.go.kr/ProtectedTree${qs}`);
      }
      if (path.startsWith('/gg-protected')) {
        const qs = injectQS(url.search, 'KEY', env.GYEONGGI_KEY);
        return proxy(`https://openapi.gg.go.kr/Protected${qs}`);
      }

      // ── 통계청 SGIS OpenAPI v3 — consumer_key/secret 주입 ──
      if (path.startsWith('/sgis')) {
        const p = new URLSearchParams(url.search ? url.search.slice(1) : '');
        p.delete('consumer_key');
        p.delete('consumer_secret');
        if (env.SGIS_KEY)    p.set('consumer_key',    env.SGIS_KEY);
        if (env.SGIS_SECRET) p.set('consumer_secret', env.SGIS_SECRET);
        return proxy(`https://sgisapi.kostat.go.kr${path.replace('/sgis', '')}?${p.toString()}`);
      }

      // ── 농업기상 관측지점 (농촌진흥청 1390802/AgriWeather) ──
      if (path.startsWith('/agriweather')) {
        const qs = injectServiceKey(url.search, env.SOILRDA_KEY);
        return proxy(`https://apis.data.go.kr/1390802/AgriWeather${path.replace('/agriweather', '')}${qs}`);
      }

      // ── 농진청 국립원예특작과학원 (1390804/Nihhs_Fruit_Area3) ──
      if (path.startsWith('/nihhs')) {
        const qs = injectServiceKey(url.search, env.SOILRDA_KEY);
        return proxy(`https://apis.data.go.kr/1390804/Nihhs_Fruit_Area3${path.replace('/nihhs', '')}${qs}`);
      }

      // ── 농경지화학성 통계 V2 (1390802/SoilEnviron/SoilExamStat) ──
      if (path.startsWith('/soil-stat')) {
        const qs = injectServiceKey(url.search, env.SOILRDA_KEY);
        return proxy(`https://apis.data.go.kr/1390802/SoilEnviron/SoilExamStat/V2${path.replace('/soil-stat', '')}${qs}`);
      }

      // ── 국가지하수정보시스템 ──
      if (path.startsWith('/groundwater')) {
        const qs = injectServiceKey(url.search, env.GROUNDWATER_KEY);
        return proxy(`https://apis.data.go.kr/1360000/GroundWaterInfoService${path.replace('/groundwater', '')}${qs}`);
      }

      // ── 토양오염도 (식품안전나라 I2390) — 키가 URL 경로에 포함됨 ──
      // 클라이언트: /soil-contamination/I2390/json/1/20?ADDR=...
      // 업스트림:   /api/{SOILCONTAM_KEY}/I2390/json/1/20?ADDR=...
      if (path.startsWith('/soil-contamination')) {
        const subPath = path.replace('/soil-contamination', '') || '';
        const key = env.SOILCONTAM_KEY ? `/${env.SOILCONTAM_KEY}` : '';
        return proxy(`https://openapi.foodsafetykorea.go.kr/api${key}${subPath}${url.search}`);
      }

      // ── 에코뱅크 WMS (국립생태원 nie-ecobank.kr) — APIKEY 주입 ──
      if (path.startsWith('/ecobank-wms')) {
        const qs = injectQS(url.search, 'APIKEY', env.ECOBANK_KEY);
        return proxy(`https://www.nie-ecobank.kr/geoserver/wms${qs}`);
      }

      // ── ECVAM 환경성평가도 WMS — APIKEY + DOMAIN 주입 (/apicall.do) ──
      if (path.startsWith('/ecvam')) {
        const p = new URLSearchParams(url.search ? url.search.slice(1) : '');
        p.delete('APIKEY'); p.delete('DOMAIN');
        if (env.ENVGRD_KEY) p.set('APIKEY',  env.ENVGRD_KEY);
        p.set('DOMAIN', env.ECVAM_DOMAIN || 'hubminyoung.github.io');
        return proxy(`https://ecvam.neins.go.kr/apicall.do?${p.toString()}`);
      }

      // ── 산림청 산림공간정보서비스 WMS (임상도 등) ──
      if (path.startsWith('/forest-wms')) {
        return proxy(`https://fgis.fs.go.kr/fgis/ogc/wms${url.search}`);
      }

      // ── 환경부 EGIS MCEE GeoServer (토지피복도 — 구 egis.me.go.kr → api.mcee.go.kr) ──
      if (path.startsWith('/egis-mcee')) {
        const subPath = path.replace('/egis-mcee', '') || '/';
        const res = await fetch(`https://api.mcee.go.kr/geoserver${subPath}${url.search}`);
        const contentType = res.headers.get('Content-Type') || 'application/json';
        return new Response(res.body, { status: res.status, headers: { ...corsHeaders, 'Content-Type': contentType } });
      }

      // ── 환경부 EGIS GeoServer WFS (토지피복도 포인트 조회 — api.mcee.go.kr) ──
      if (path.startsWith('/egis-wfs')) {
        const res = await fetch(`https://api.mcee.go.kr/geoserver/wfs${url.search}`);
        const contentType = res.headers.get('Content-Type') || 'application/json';
        return new Response(res.body, { status: res.status, headers: { ...corsHeaders, 'Content-Type': contentType } });
      }

      // ── 환경부 EGIS GeoServer WMS (토지피복도·생태자연도 — api.mcee.go.kr) ──
      if (path.startsWith('/egis')) {
        const res = await fetch(`https://api.mcee.go.kr/geoserver/wms${path.replace('/egis', '') || ''}${url.search}`);
        const contentType = res.headers.get('Content-Type') || 'application/json';
        return new Response(res.body, { status: res.status, headers: { ...corsHeaders, 'Content-Type': contentType } });
      }

      // ── 기상청 API허브 (apihub.kma.go.kr) — authKey 주입 ──
      if (path.startsWith('/kma-hub')) {
        const subPath = path.replace('/kma-hub', '') || '';
        const qs = injectQS(url.search, 'authKey', env.KMAHUB_KEY);
        const res = await fetch(`https://apihub.kma.go.kr${subPath}${qs}`, {
          headers: { 'Accept': 'text/plain, application/json, */*' }
        });
        const contentType = res.headers.get('Content-Type') || 'text/plain; charset=utf-8';
        return new Response(res.body, { status: res.status, headers: { ...corsHeaders, 'Content-Type': contentType } });
      }

      return new Response('Not found', { status: 404, headers: corsHeaders });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
