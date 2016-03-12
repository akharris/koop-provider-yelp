const YelpClient = require('yelp')
const proj4 = require('proj4')
const proj = proj4('GOOGLE', 'WGS84')
const config = require('config')
const _ = require('lodash')
const async = require('async')
const Yelp = function (koop) {
  var yelp = {}

  const client = new YelpClient(config.yelp)

  // This is our one public function it's job its to fetch data from Yelp and return GeoJSON
  yelp.search = function (options, callback) {
    const queries = buildQueries(options)
    const featureCollection = {
      type: 'FeatureCollection',
      features: []
    }

    async.each(queries, search, finish)

    function search (query, callback) {
      searchYelp(query, function (err, features) {
        if (err) return callback(err)
        featureCollection.features = featureCollection.features.concat(features)
        callback()
      })
    }

    function finish (err) {
      callback(err, featureCollection)
    }
  }

  // Wrap the call to Yelp, this will make testing easier and decouple us from the specific client lib
  function searchYelp (query, callback) {
    client.search(query, function (err, rawResponse) {
      if (err) return callback(err)
      const features = translate(rawResponse)
      callback(null, features)
    })
  }

  function buildQueries (options) {
    if (options.geometry) {
      const geometries = splitGeometry(options.geometry)
      return geometries.map(geometry => buildQuery(options, geometry))
    } else {
      return [buildQuery(options)]
    }
  }

  // Translate a request from the GeoServices API into something Yelp will understand
  function buildQuery (options, geometry) {
    // we don't want to modify the passed in options object because Koop will use that later
    // also for some reason the Yelp lib chokes when there is a passed in callback so omit it
    const query = _.omit(_.cloneDeep(options), 'callback')
    if (geometry || options.geometry) {
      const bbox = geometry || JSON.parse(options.geometry)
      query.bounds = setBounds(bbox)
    } else if (!options.location) {
      query.location = 'Washington, DC'
    }
    query.term = setTerm(options)
    query.sort = setSort(options)
    query.limit = 20
    return query
  }

  // This function translates a geoservices geometry query the Yelp APIs weird format
  function setBounds (bbox) {
    return proj.forward([bbox.xmin, bbox.ymin]).reverse().toString() + '|' + proj.forward([bbox.xmax, bbox.ymax]).reverse().toString()
  }

  // This function parses the search term from a geoservices where clause
  // 'where term = 'restaurants' => restaurants
  function setTerm (options) {
    if (!options.where) return null
    const match = options.where.match(/.+\s+=\s+'(.+)'/)
    return match ? match[1] : null
  }

  // This function handles the sort part of yelps query. Depending on the type of search we are doing
  // we may want to sort by distance, rating or best match
  function setSort (options) {
    if (options.orderByFields && options.orderByFields === 'rating') {
      // Highest rated
      return 2
    } else if (options.term) {
      // Best match
      return 0
    } else {
      // Distance
      return 1
    }
  }

  // Map accross all elements from a Yelp respsonse and translate it into a feature collection
  function translate (data) {
    // protect ourself in case the request did not return any features
    if (data.businesses) return data.businesses.map(formatFeature)
  }

  // This function takes a single element from the yelp response and translates it to GeoJSON
  function formatFeature (biz) {
    const loc = biz.location
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [loc.coordinate.longitude, loc.coordinate.latitude]
      },
      properties: {
        name: biz.name,
        phone: biz.display_phone,
        rating: biz.rating,
        review_count: biz.review_count,
        snippet_text: biz.snippet_text,
        snippet_image_url: biz.snippet_url,
        image: biz.image_url,
        display_address: loc.display_address.join(', '),
        city: loc.city,
        state: loc.state_code,
        zip: loc.postal_code,
        yelp_page: biz.url,
        rating_img: biz.rating_img_url_small,
        yelp_id: biz.id,
        is_closed: biz.is_closed,
        term: 'String' // We put a dummy term in here so ArcGIS knows this is a string field. It will allow us to filter
      }
    }
  }
  return yelp
}

function splitGeometry (bbox) {
  return [
    bottomLeft(bbox),
    bottomRight(bbox),
    topLeft(bbox),
    topRight(bbox)
  ]
}

function bottomLeft (bbox) {
  return {
    xmin: bbox.xmin,
    ymin: bbox.ymin,
    xmax: avgOf2(bbox.xmin, bbox.xmax),
    ymax: avgOf2(bbox.ymin, bbox.ymax)
  }
}

function bottomRight (bbox) {
  return {
    xmin: avgOf2(bbox.xmin, bbox.xmax),
    ymin: bbox.ymin,
    xmax: bbox.ymax,
    ymax: avgOf2(bbox.ymin, bbox.ymax)
  }
}

function topLeft (bbox) {
  return {
    xmin: bbox.xmin,
    ymin: avgOf2(bbox.ymin, bbox.ymax),
    xmax: avgOf2(bbox.xmin, bbox.xmax),
    ymax: bbox.ymax
  }
}

function topRight (bbox) {
  return {
    xmin: avgOf2(bbox.xmin, bbox.xmax),
    ymin: avgOf2(bbox.ymin, bbox.ymax),
    xmax: bbox.xmax,
    ymax: bbox.ymax
  }
}

function avgOf2 (a, b) {
  return (a + b) / 2
}
module.exports = Yelp
