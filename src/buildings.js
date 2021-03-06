/*jshint bitwise:false */

(function (global) {

    'use strict';

    global.Int32Array = global.Int32Array || Array;

    var
        VERSION = '0.1a',

        exp = Math.exp,
        log = Math.log,
        tan = Math.tan,
        atan = Math.atan,
        min = Math.min,
        max = Math.max,
        PI = Math.PI,
        HALF_PI = PI / 2,
        QUARTER_PI = PI / 4,
        RAD = 180 / PI,

        LAT = 'latitude', LON = 'longitude',
        HEIGHT = 0, FOOTPRINT = 1, IS_NEW = 2,

        // map values
        width = 0, height = 0,
        halfWidth = 0, halfHeight = 0,
        centerX = 0, centerY = 0,
        zoom, size,

        req,

        canvas, context,

        url,
        strokeRoofs,
        wallColor = 'rgb(200,190,180)',
        roofColor = 'rgb(250,240,230)',
        strokeColor = 'rgb(145,140,135)',

        rawData,
        meta, data,

        zoomAlpha = 1,
        fadeFactor = 1,
        fadeTimer,

        TILE_SIZE = 256,
        MIN_ZOOM = 14, MAX_ZOOM,

        CAM_X = halfWidth,
        CAM_Y = height,
        CAM_Z = 400,

        MAX_HEIGHT = CAM_Z - 50,

        isZooming = false
    ;

    function createCanvas(parentNode) {
        canvas = global.document.createElement('canvas');
        canvas.style.webkitTransform = 'translate3d(0,0,0)';
        canvas.style.position = 'absolute';
        canvas.style.pointerEvents = 'none';
        canvas.style.left = 0;
        canvas.style.top = 0;
        parentNode.appendChild(canvas),

        context = canvas.getContext('2d')
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.lineWidth = 1;

        try { context.mozImageSmoothingEnabled = false } catch(err) {}
    }

    function setStyle(style) {
        style = style || {};
        strokeRoofs = style.strokeRoofs !== undefined ? style.strokeRoofs : strokeRoofs;
        wallColor   = style.wallColor   || wallColor;
        roofColor   = style.roofColor   || roofColor;
        strokeColor = style.strokeColor || strokeColor;
    }

    function pixelToGeo(x, y) {
        var res = {};
        x /= size;
        y /= size;
        res[LAT] = y <= 0  ? 90 : y >= 1 ? -90 : RAD * (2 * atan(exp(PI * (1 - 2 * y))) - HALF_PI),
        res[LON] = (x === 1 ?  1 : (x % 1 + 1) % 1) * 360 - 180;
        return res;
    }

    function geoToPixel(lat, lon, z) {
        var
            totalPixels = TILE_SIZE << z,
            latitude = min(1, max(0, 0.5 - (log(tan(QUARTER_PI + HALF_PI * lat / 180)) / PI) / 2)),
            longitude = lon / 360 + 0.5
        ;
        return {
            x: ~~(longitude * totalPixels),
            y: ~~(latitude  * totalPixels)
        };
    }

    function template(str, data) {
        return str.replace(/\{ *([\w_]+) *\}/g, function(x, key) {
            return data[key] || '';
        });
    }

    function xhr(url, callback) {
        var req = new XMLHttpRequest();
        req.onreadystatechange = function () {
            if (req.readyState !== 4) {
                return;
            }
            if (!req.status || req.status < 200 || req.status > 299) {
                return;
            }
            if (req.responseText) {
                callback(JSON.parse(req.responseText));
            }
        };
        req.open('GET', url);
        req.send(null);
        return req;
    }

    function loadData() {
        if (!url || zoom < MIN_ZOOM) {
            return;
        }
        var
            // create bounding box of double viewport size
            nw = pixelToGeo(centerX - width, centerY - height),
            se = pixelToGeo(centerX + width, centerY + height)
        ;
        if (req) {
            req.abort();
        }
        req = xhr(template(url, {
            w: nw[LON],
            n: nw[LAT],
            e: se[LON],
            s: se[LAT],
            z: zoom
        }), onDataLoaded);
    }

    function setData(json, isLonLat) {
        if (!json) {
            rawData = null;
            render(); // effectively clears
            return;
        }

        rawData = jsonToData(json, isLonLat);

        meta = {
            n: 90,
            w: -180,
            s: -90,
            e: 180,
            x: 0,
            y: 0,
            z: zoom
        };
        data = scaleData(rawData, zoom, true);

        fadeIn();
    }

    function jsonToData(json, isLonLat, data) {
        data = data || [];
//        if (typeof data === 'undefined') {
//            data = [];
//        }

        var
            features = json[0] ? json : json.features,
            geometry, coords, properties,
            footprint,
            p,
            i, il
        ;

        if (features) {
            for (i = 0, il = features.length; i < il; i++) {
                jsonToData(features[i], isLonLat, data);
            }
            return data;
        }

        if (json.type === 'Feature') {
            geometry = json.geometry;
            properties = json.properties;
        }
//      else geometry = json

        if (geometry.type == 'Polygon' && properties.height) {
            coords = geometry.coordinates[0];
            footprint = [];
            // TODO: combine this loop with winding handling
            for (i = 0, il = coords.length; i < il; i++) {
                if (isLonLat) {
                    footprint.push(coords[i][1]);
                    footprint.push(coords[i][0]);
                } else {
                    footprint.push(coords[i][0]);
                    footprint.push(coords[i][1]);
                }
            }
            data.push([properties.height, makeClockwiseWinding(footprint)]);
        }

        return data;
    }

    function scaleData(data, zoom, isNew) {
        var
            res = [],
            height,
            coords,
            footprint,
            p,
            z = MAX_ZOOM - zoom
        ;

        for (var i = 0, il = data.length; i < il; i++) {
            height = data[i][0];
            coords = data[i][1];
            footprint = new Int32Array(coords.length);
            for (var j = 0, jl = coords.length - 1; j < jl; j += 2) {
                p = geoToPixel(coords[j], coords[j + 1], zoom);
                footprint[j]     = p.x;
                footprint[j + 1] = p.y;
            }
            res[i] = [
                min(height >> z, MAX_HEIGHT),
                footprint,
                isNew
            ];
        }

        return res;
    }

    // detect polygon winding direction: clockwise or counter clockwise
    // TODO: optimize
    function getPolygonWinding(points) {
        var num = points.length;
        var maxN = maxS = points[0];
        var maxE = maxW = points[1];
        var WI, EI;

        for (var i = 0; i < num - 1; i += 2) {
            if (points[i + 1] < maxW) {
                maxW = points[i + 1];
                WI = i;
            } else if (points[i + 1] > maxE) {
                maxE = points[i + 1];
                EI = i;
            }

            if (points[i] > maxN) {
                maxN = points[i];
                NI = i;
            }
        }

        var W = WI-NI;
        var E = EI-NI;

        if (W < 0) W += num;
        if (E < 0) E += num;

        return (W > E) ? 'CW' : 'CCW';
    }

    // make polygon winding clockwise. This is needed for proper backface culling on client side.
    // TODO: optimize
    function makeClockwiseWinding(points) {
        var winding = getPolygonWinding(points);
        if (winding === 'CW') {
            return points;
        }
        var revPoints = [];
        for (var i = points.length - 2; i >= 0; i -= 2) {
            revPoints.push(points[i]);
            revPoints.push(points[i + 1]);
        }
        return revPoints;
    }

    //*** positioning helpers *************************************************

    function setSize(w, h) {
        width = w;
        height = h;
        halfWidth  = ~~(width / 2);
        halfHeight = ~~(height / 2);
        CAM_X = halfWidth;
        CAM_Y = height;
        canvas.width = width;
        canvas.height = height;
    }

    function setCenter(x, y) {
        centerX = x;
        centerY = y;
    }

    function setZoom(z) {
        zoom = z;
        size = TILE_SIZE << zoom;
        // maxAlpha - (zoom-MIN_ZOOM) * (maxAlpha-minAlpha) / (MAX_ZOOM-MIN_ZOOM)
        zoomAlpha = 1 - (zoom - MIN_ZOOM) * 0.3 / (MAX_ZOOM - MIN_ZOOM);
    }

    //*** event handlers ******************************************************

    function onResize(e) {
        setSize(e.width, e.height);
        render();
        loadData();
    }

    function onMove(e) {
        setCenter(e.x, e.y);
        render();
    }

    function onMoveEnd(e) {
        var
            nw = pixelToGeo(centerX - halfWidth, centerY - halfHeight),
            se = pixelToGeo(centerX + halfWidth, centerY + halfHeight)
        ;
        // check, whether viewport is still within loaded data bounding box
        if (meta && (nw[LAT] > meta.n || nw[LON] < meta.w || se[LAT] < meta.s || se[LON] > meta.e)) {
            loadData();
        }
    }

    function onZoomStart(e) {
        isZooming = true;
        render(); // effectively clears
    }

    function onZoomEnd(e) {
        isZooming = false;
        setZoom(e.zoom);
        if (!rawData) {
            loadData();
            return
        }
        data = scaleData(rawData, zoom);
        render();
    }

    function onDataLoaded(res) {
        var
            i, il,
            resData, resMeta,
            keyList = [], k,
            offX = 0, offY = 0
        ;

        req = null;

        // no response or response not matching current zoom (= too old response)
        if (!res || res.meta.z !== zoom) {
            return;
        }

        resMeta = res.meta;
        resData = res.data;

        // offset between old and new data set
        if (meta && data && meta.z === resMeta.z) {
            offX = meta.x - resMeta.x;
            offY = meta.y - resMeta.y;

            // identify already present buildings to fade in new ones
            for (i = 0, il = data.length; i < il; i++) {
                // id key: x,y of first point - good enough
                keyList[i] = (data[i][FOOTPRINT][0] + offX) + ',' + (data[i][FOOTPRINT][1] + offY);
            }
        }

        meta = resMeta;
        data = [];

        for (i = 0, il = resData.length; i < il; i++) {
            data[i] = resData[i];
            data[i][HEIGHT] = min(data[i][HEIGHT], MAX_HEIGHT);
            k = data[i][FOOTPRINT][0] + ',' + data[i][FOOTPRINT][1];
            data[i][IS_NEW] = !(keyList && ~keyList.indexOf(k));
        }

        resMeta = resData = keyList = null; // gc

        fadeIn();
    }

    //*** rendering ***********************************************************

    function fadeIn() {
        fadeFactor = 0;
        clearInterval(fadeTimer);
        fadeTimer = setInterval(function () {
            fadeFactor += 0.5 * 0.2; // amount * easing
            if (fadeFactor > 1) {
                clearInterval(fadeTimer);
                fadeFactor = 1;
                // unset 'already present' marker
                for (var i = 0, il = data.length; i < il; i++) {
                    data[i][IS_NEW] = 0;
                }
            }
            render();
        }, 33);
    }

    function render() {
        context.clearRect(0, 0, width, height);

        // data needed for rendering
        if (!meta || !data) {
            return;
        }

        // show buildings in high zoom levels only
        // avoid rendering during zoom
        if (zoom < MIN_ZOOM || isZooming) {
            return;
        }

        var
            wallColorAlpha   = setAlpha(wallColor,   zoomAlpha),
            roofColorAlpha   = setAlpha(roofColor,   zoomAlpha),
            strokeColorAlpha = setAlpha(strokeColor, zoomAlpha)
        ;

        context.strokeStyle = strokeColorAlpha;

        var
            i, il, j, jl,
            item,
            f, h, m,
            x, y,
            offX = centerX - halfWidth  - meta.x,
            offY = centerY - halfHeight - meta.y,
            footprint, roof, walls,
            isVisible,
            ax, ay, bx, by, _a, _b
        ;

        for (i = 0, il = data.length; i < il; i++) {
            item = data[i];
            isVisible = false;
            f = item[FOOTPRINT];
            footprint = new Int32Array(f.length);
            for (j = 0, jl = f.length - 1; j < jl; j += 2) {
                footprint[j]     = x = (f[j]     - offX);
                footprint[j + 1] = y = (f[j + 1] - offY);

                // checking footprint is sufficient for visibility
                if (!isVisible) {
                    isVisible = (x > 0 && x < width && y > 0 && y < height);
                }
            }

            if (!isVisible) {
                continue;
            }

            // drawing walls
            context.fillStyle = wallColorAlpha;

            // when fading in, use a dynamic height
            h = item[IS_NEW] ? item[HEIGHT] * fadeFactor : item[HEIGHT];

            // precalculating projection height scale
            m = CAM_Z / (CAM_Z - h);

            roof = new Int32Array(footprint.length - 2);
            walls = [];

            for (j = 0, jl = footprint.length - 1 - 2; j < jl; j += 2) {
                ax = footprint[j];
                ay = footprint[j + 1];
                bx = footprint[j + 2];
                by = footprint[j + 3];

                // project 3d to 2d on extruded footprint
                _a = project(ax, ay, m);
                _b = project(bx, by, m);

                // backface culling check. could this be precalculated partially?
                if ((bx - ax) * (_a.y - ay) > (_a.x - ax) * (by - ay)) {
                    // face combining
                    if (!walls.length) {
                        walls.unshift(ay);
                        walls.unshift(ax);
                        walls.push(_a.x);
                        walls.push(_a.y);
                    }

                    walls.unshift(by);
                    walls.unshift(bx);
                    walls.push(_b.x);
                    walls.push(_b.y);
                } else {
                    drawShape(walls);
                    walls = [];
                }

                roof[j]     = _a.x;
                roof[j + 1] = _a.y;
            }

            drawShape(walls);

            // fill roof and optionally stroke it
            context.fillStyle = roofColorAlpha;
            drawShape(roof, strokeRoofs);
        }
    }

    function drawShape(points, stroke) {
        context.beginPath();
        context.moveTo(points[0], points[1]);
        for (var i = 2, il = points.length; i < il; i += 2) {
            context.lineTo(points[i], points[i + 1]);
        }
        context.closePath();
        if (stroke) {
            context.stroke();
        }
        context.fill();
    }

    function project(x, y, m) {
        return {
            x: ~~((x - CAM_X) * m + CAM_X),
            y: ~~((y - CAM_Y) * m + CAM_Y)
        };
    }

    function setAlpha(rgb, a) {
        var m = rgb.match(/rgba?\((\d+),(\d+),(\d+)(,([\d.]+))?\)/);
        return 'rgba(' + [m[1], m[2], m[3], (m[4] ? a * m[5] : a)].join(',') + ')';
    }

    var B = global.OSMBuildings = function (map) {
        this.addTo(map);
    };
    B.prototype.VERSION = VERSION;
    B.prototype.render = function () {
        if (this.map) {
            render();
            return this;
        }
    };
    B.prototype.setStyle = function (style) {
        if (this.map) {
            setStyle(style);
            return this;
        }
    };
    B.prototype.setData = function (data, isLonLat) {
        if (this.map) {
            setData(data, isLonLat);
            return this;
        }
    };
    B.prototype.loadData = function (u) {
        if (this.map) {
            url = u;
            loadData();
            return this;
        }
    };

    //*** BEGIN leaflet patch

    (function (proto) {

        var attribution = 'Buildings &copy; <a href="http://osmbuildings.org">OSM Buildings</a>';

        proto.VERSION += '-leaflet-patch';

        proto.addTo = function(map) {
            this.map = map;

            function calcCenter() {
                var half = map._size.divideBy(2);
                return map._getTopLeftPoint().add(half);
            }

            createCanvas(document.querySelector('.leaflet-control-container'));
            MAX_ZOOM = map._layersMaxZoom;

            setSize(map._size.x, map._size.y);
            var c = calcCenter();
            setCenter(c.x, c.y);
            setZoom(map._zoom);

            var resizeTimer;
            window.addEventListener('resize', function () {
                resizeTimer = setTimeout(function () {
                    clearTimeout(resizeTimer);
                    onResize({ width:map._size.x, height:map._size.y });
                }, 100);
            }, false);

            map.on({
                move: function () {
                    onMove(calcCenter());
                },
                moveend: function () {
                    onMoveEnd(calcCenter());
                },
                zoomstart: onZoomStart,
                zoomend: function () {
                    onZoomEnd({ zoom: map._zoom });
                } //,
//                viewreset: function handleResize() {}
            });

            map.attributionControl.addAttribution(attribution);
            return this;
        }

        proto.removeFrom = function(map) {
            map.attributionControl.removeAttribution(attribution);

            map.off({
//              move: function () {},
//              moveend: function () {},
//              zoomstart: onZoomStart,
//              zoomend: function () {},
//              viewreset: function() {}
            });

            canvas.parentNode.removeChild(canvas);
            this.map = null;
            return this;
        }

    }(B.prototype));

    //*** END leaflet patch

}(this));

/*jshint bitwise:true */

/**
 * @example
var map = new L.Map('map');

var buildings = new OSMBuildings(
    'server/?w={w}&n={n}&e={e}&s={s}&z={z}',
    {
        strokeRoofs: false,
        wallColor: 'rgb(190,170,150)',
        roofColor: 'rgb(230,220,210)',
        strokeColor: 'rgb(145,140,135)'
    }
);

buildings.addTo(map);
*/

/**
 * @example
var map = new L.Map('map');
new OSMBuildings('server/?w={w}&n={n}&e={e}&s={s}&z={z}').addTo(map);
*/
