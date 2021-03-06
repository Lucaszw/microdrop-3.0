const $ = require('jquery');
const _ = require('lodash');
const Backbone = require('backbone');
const Colormap = require('colormap');
const THREE = require('three');
const {MeshLine, MeshLineMaterial} = require( 'three.meshline' );
const Polygon = require('polygon');
const yo = require('yo-yo');

const MicropedeAsync = require('@micropede/client/src/async.js');
const {MicropedeClient} = require('@micropede/client/src/client.js');
const MicrodropHelpers = require('@microdrop/helpers');

const SVGRenderer = require('./svg-renderer');

const DEFAULT_TIMEOUT = 5000;
const DIRECTIONS = {LEFT: "left", UP: "up", DOWN: "down", RIGHT: "right"};
const MAX_DISTANCE = 0.5;
const NEIGHBOUR_COLOR = "rgb(219, 215, 215)";
const OFF_COLOR = "rgb(175, 175, 175)";
const ON_COLOR = "rgb(245, 235, 164)";
const SELECTED_COLOR = "rgb(120, 255, 168)";
const DEFAULT_OFF_OPACITY  = 0.3;
const DEFAULT_ON_OPACITY  = 0.3;

const APPNAME = 'microdrop';
const DEFAULT_PORT = 8083;
const DEFAULT_HOST = 'localhost';

const ElectrodeSchema = {
  type: "object",
  properties: {
    "selected-electrode": {
      type: "object",
      "properties": {
        id: {type: "string", set_with: 'selected-electrode', per_step: false, editable: false},
        channel:  {type: ["string", "number"], set_with: 'selected-electrode', per_step: false}
      },
      per_step: false,
      required: ['id', 'channel']
    }
  },
};


class ElectrodeControls extends MicropedeClient {
  constructor(scene, camera, renderer, container=null, port=DEFAULT_PORT) {
    if (!container) container = document.body;
    let options = {resubscribe: false};
    if (window) options.storageUrl = window.location.origin;
    super(APPNAME, DEFAULT_HOST, port, undefined, undefined, options);
    this.schema = ElectrodeSchema;
    this.selectedElectrode = null;
    this.svgGroup = null;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.container = container;

    this.overlays = [];
    this.port = port;

    // Mouse event assigned using THREEx.DomEvents in svg-renderer
    this.enabled = true;
    this.on("mousedown", this.mousedown.bind(this));
    this.on("touchstart", this.mousedown.bind(this));
    this.layers = 1;
    this.offOpacity = DEFAULT_OFF_OPACITY;
    this.onOpacity  = DEFAULT_ON_OPACITY;
  }

  setSelectedElectrode(obj) {
    this.selectedElectrode = obj;
    let electrode;
    if (obj) {
      let hiddenKeys = ['shape', 'translation'];
      electrode = _.omit(_.find(this._threeObject, {id: obj.name}), hiddenKeys);
      this.trigger('change-schema', {name: 'electrode-controls'});
      this.setState('selected-electrode', electrode);
    }
  }

  async putSelectedElectrode(payload, params) {
    const {id, channel, area} = payload['selected-electrode'];

    let electrode = _.find(this._threeObject, {id});
    electrode.channel = channel;
    electrode.area = area;

    const microdrop = new MicropedeAsync('microdrop', undefined, this.port);
    await microdrop.putPlugin('device-model', 'three-object', this._threeObject);
  }

  listen() {
    this.onStateMsg("electrodes-model", "active-electrodes", this.drawElectrodes.bind(this));
    this.onStateMsg("device-model", "overlays", this.updateOverlays.bind(this));
    this.onStateMsg("device-model", "three-object", (payload, params) => {
      this._threeObject = payload;
    });

    this.bindTriggerMsg("global-ui-plugin", "change-schema", "change-schema");
    this.onPutMsg("selected-electrode", this.putSelectedElectrode.bind(this));
    this.render();
  }

  get showChannels() {
    return this._showChannels || false;
  }

  set showChannels(_showChannels) {
    this._showChannels = _showChannels;
    if (_showChannels) {
      for (const child of [...this.svgGroup.children]) {
        child.fill.material.map = child.texture;
        child.fill.material.map.needsUpdate = true;
        child.fill.material.needsUpdate = true;
      }
    } else {
      for (const child of [...this.svgGroup.children]) {
        child.fill.material.map = null;
        child.fill.material.needsUpdate = true;
      }
    }
  }

  setOnOpacity(opacity) {
    this.onOpacity = opacity;
    this.opacityUpdated();
  }

  setOffOpacity(opacity) {
    this.offOpacity = opacity;
    this.opacityUpdated();
  }

  opacityUpdated() {
    /* Called after off / on opacity is updated*/
    let children = this.svgGroup.children;
    let selectedElectrode = this.selectedElectrode || {name: null};
    _.each(children, (child) => {
      _.set(child, 'fill.material.opacity', child.on ? this.onOpacity : this.offOpacity);
      let prevColor = child.outline.material.color;
      let material = new MeshLineMaterial({
        color: prevColor,
        lineWidth: 0.2,
        opacity: (child.on && child.name != selectedElectrode.name) ? 0 : this.offOpacity,
        transparent: true
      });
      material.color = prevColor;
      child.outline.material = material;
    });
  }

  drawElectrodes(elec) {
    const LABEL = "ElectrodeControls::drawElectrodes";
    const objects = this.svgGroup.children;
    const onColor  = new THREE.Color(ON_COLOR);
    const offColor = new THREE.Color(OFF_COLOR);

    // Change previously on electrodes to off color
    const prevOn  = _.filter(objects, ["fill.material.color", onColor]);
    for (const [i, obj] of prevOn.entries()) {
      obj.fill.material.color = offColor;
      obj.fill.material.opacity = this.offOpacity;
      obj.on = false;

      let selected = this.selectedElectrode || {name: null};
      let color = new THREE.Color(obj.name == selected.name ? 'red' : 'black');
      let material = new MeshLineMaterial({
        color: color,
        lineWidth: 0.2,
        opacity: this.offOpacity,
        transparent: true
      });
      material.color = color;
      obj.outline.material = material;
    }

    // Change currently on electrodes to on color
    const currOn = _.filter(objects, (o)=>{return _.includes(elec, o.name)});
    for (const [i, obj] of currOn.entries()) {
      obj.fill.material.color = onColor;
      obj.fill.material.opacity = this.onOpacity;
      obj.on = true;

      let selected = this.selectedElectrode || {name: null};
      if (obj.name == selected.name) continue;

      let color = new THREE.Color('black');
      let material = new MeshLineMaterial({
        color: color,
        lineWidth: 0.2,
        opacity: 0,
        transparent: true
      });
      material.color = color;
      obj.outline.material = material;
    }
  }

  drawColorOverlay(overlay, group) {
    let colors = Colormap({
        colormap: overlay.colorMap,
        nshades: overlay.colorRange,
        format: 'hex',
        alpha: 1
    });

    if (overlay.colorAll) {
      for (const [i, obj] of group.children.entries()) {
        const mesh = _.find(obj.children, ["geometry.type", "ExtrudeGeometry"]);
        mesh.material.color = new THREE.Color(colors[overlay.colorRange/2]);
      }
    }

    for (const [name, val] of Object.entries(overlay.electrodes)) {
      const obj = _.find(group.children, {name});
      const mesh = _.find(obj.children, ["geometry.type", "ExtrudeGeometry"]);
      mesh.material.color = new THREE.Color(colors[val.intensity]);
    }
  }

  drawShapeOverlay(overlay, group) {
    const defaultSize = 3; // XXX: Should be mean or median electrode size
    const defaultScale = 0.2; // XXX: Should get from scale

    let colors = Colormap({
        colormap: overlay.colorMap,
        nshades: 10,
        format: 'hex',
        alpha: 1
    });

    // const radius = _.meanBy(group)
    const addCircle = (obj, scale, numEdges) => {
      const mesh = _.find(obj.children, ["geometry.type", "ExtrudeGeometry"]);
      mesh.geometry.computeBoundingBox();
      const size = mesh.geometry.boundingBox.getSize();
      const radius = defaultSize * scale;

      var geometry = new THREE.CircleGeometry( radius, overlay.numEdges );
      var material = new THREE.MeshBasicMaterial( { color: colors[4] } );
      var circle = new THREE.Mesh( geometry, material );
      obj.add( circle );
    };

    if (overlay.shapeAll) {
      for (const [i, obj] of group.children.entries()) {
        addCircle(obj, defaultScale, overlay.numEdges);
      }
    }

    for (const [name, val] of Object.entries(overlay.electrodes)) {
      const obj = _.find(group.children, {name});
      addCircle(obj, val.scale, overlay.numEdges);
    }
  }

  async render() {
    const threeObject = await this.getState('three-object', 'device-model');
    _.each(this.svgGroup.children, async (child) => {
      child.texture = this.generateTextTextureForElectrode(child, threeObject);
    });
  }

  generateTextTextureForElectrode(electrode, threeObject) {
    const obj = _.find(threeObject, {id: electrode.name});

    const number = obj.channel;
    // const number = name.split('electrode')[1];
    const material = electrode.fill.material;

    // Create a canvas containg text for the electrode number
    const canvas = yo`<canvas width="255" height="255"></canvas>`;
    const ctx = canvas.getContext("2d");
    ctx.save();

    // Get required fontsize to span canvas
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect( 0, 0, canvas.width, canvas.height );

    const prevFontSize = 30;
    ctx.font = `${prevFontSize}px Courier`;
    const prevWidth = ctx.measureText(number).width;
    const newFontSize = (0.8*canvas.width * prevFontSize)/prevWidth;

    // Adjust font to match canvas width, and scale to match canvas height
    ctx.scale(1, canvas.height/newFontSize);
    ctx.font = `${newFontSize}px Courier`;
    ctx.fillStyle = "#000000";
    ctx.fillText(number,0.1*canvas.width,newFontSize/1.2);
    ctx.restore();

    return new THREE.Texture( canvas );
  }
  drawOverlay(overlay) {
    if (!overlay.visible) return;

    const group = this.svgGroup.clone();
    group.traverse( function( node ) {

      const type = _.get(node, "geometry.type");

      if (type == "BufferGeometry") {
        node.parent.remove(node);
        return;
      }

      if( node.material ) {
        node.material = node.material.clone();
        node.material.opacity = 0.1;
        node.material.transparent = true;
      }
    });

    if (overlay.type == "colormap") {
      this.drawColorOverlay(overlay, group);
    } else if (overlay.type == "shapemap") {
      this.drawShapeOverlay(overlay, group);
    } else {
      return;
    }

    group.name = overlay.name;
    this.scene.add(group);
    this.overlays.push(group);
    group.position.z += 0.1*(this.overlays.length);
  }

  updateOverlays(payload) {
    const LABEL = "<ElectrodeControls::updateOverlays>";
    const scene = this.scene;

    _.each(this.overlays, (o) => this.scene.remove(o));
    this.overlays = [];

    _.each(payload, this.drawOverlay.bind(this));
  }

  async loadSvg(f='default.svg') {
    var d = await SVGRenderer.init(f, this.scene, this.camera, this.renderer, this.container, this);
    this.electrodeObjects = d.objects;
    this.svgGroup = d.container;
    this.scene.add(this.svgGroup);
  }

  async turnOnElectrode(electrodeId) {
    try {
      const electrodeObject = this.electrodeObjects[electrodeId];
      electrodeObject.on = true;
      let microdrop = new MicropedeAsync(APPNAME, 'localhost', this.port);
      await microdrop.triggerPlugin('electrodes-model', 'toggle-electrode',
        {electrodeId, state: true});
    } catch (e) {
      // console.error(e);
    }
  }

  async turnOffElectrode(electrodeId) {

    try {
      const electrodeObject = this.electrodeObjects[electrodeId];
      let microdrop = new MicropedeAsync(APPNAME, 'localhost', this.port);

      electrodeObject.on = false;
      await microdrop.triggerPlugin('electrodes-model', 'toggle-electrode',
        {electrodeId: electrodeId, state: false}, 500);
    } catch (e) {
      // console.error(e);
    }
  }

  async move(dir='right') {
    try {
      if (!this.selectedElectrode) return;
      let microdrop = new MicropedeAsync(APPNAME, 'localhost', this.port);
      const electrodeId = this.selectedElectrode.name;
      let neighbours;

      neighbours = (await microdrop.triggerPlugin('device-model',
        'get-neighbouring-electrodes', {electrodeId}, 500)).response;


      const neighbour = neighbours[dir];

      if (!neighbour) return;
      await this.turnOffElectrode(electrodeId);
      this.selectElectrode(neighbour);
    } catch (e) {
      console.error(e);
    }
  }

  getNeighbours(electrodeId) {
    const LABEL = "<ElectrodeControls::getNeighbours>";
    if (!this.electrodeObjects[electrodeId]) return [];

    const neighbours = {};
    for (const [k, dir] of Object.entries(DIRECTIONS)) {
      const neighbour = FindNeighbourInDirection(this.svgGroup, electrodeId, dir);
      if (neighbour) {
        neighbours[neighbour.name] = dir;
      }
    }
    return neighbours;
  }

  findNeighbour(dir='right', electrodeId) {
    /* Find neighbours of given electrode */
    let obj = this.electrodeObjects[electrodeId];
    const collisionObjects = _.map(_.values(this.electrodeObjects), "fill");

    // If the user didn't pass in an electrode, use the selectedElectrode
    if (!electrodeId && this.selectedElectrode)
      obj = this.selectedElectrode;

    if (obj == undefined) return undefined;
    const intersects = FindIntersectsInDirection(obj.fill, dir, collisionObjects);
    // Use first intersect for now:
    // const intersect = intersects[0];
    const intersect = _.minBy(intersects, 'distance');
    if (!intersect) return undefined;

    const neighbour = new Object();
    neighbour.distance = intersect.distance;
    neighbour.electrodeObject = intersect.object.parent;
    neighbour.electrodeId = neighbour.electrodeObject.name;
    return neighbour;
  }

  unselectElectrode() {
    let color = new THREE.Color("black");
    let material = new MeshLineMaterial({
      color: color,
      opacity: this.offOpacity,
      lineWidth: 0.2,
      transparent: true
    });
    material.color = color;
    this.selectedElectrode.outline.material = material;

    this.setSelectedElectrode(null);
  }

  selectElectrode(electrodeId, turnOn=true) {
    /* Change the electrode currently being tracked*/

    // Reset the outline of the previously selected electrode
    if (this.selectedElectrode) {
      this.unselectElectrode();
    }

    // Turn on and color the selected electrode
    if (turnOn == true) this.turnOnElectrode(electrodeId);

    const electrodeObject = this.electrodeObjects[electrodeId];

    let color = new THREE.Color("red");
    let material = new MeshLineMaterial({
      color: color,
      opacity: this.onOpacity,
      lineWidth: 0.2,
      transparent: true
    });
    material.color = color;
    electrodeObject.outline.material = material;

    this.setSelectedElectrode(electrodeObject);
  }

  async mousedown(event) {
    if (!this.enabled) return;

    /* Called when electrode object is clicked */
    if (event.origDomEvent.button != 0) {
      this.trigger("right-click", event);
      return;
    }
    if (event.origDomEvent.altKey) return;

    // Await for mouse up event
    const mouseUp = () => {
      return new Promise((resolve, reject) => {
        this.on("mouseup",  (e) => {resolve(e);});
        this.on("mouseover", (e) => {resolve(e);})
      });
    };
    const event2 = await mouseUp();

    // If event targets don't match, don't turn on electrode
    if (event.target.uuid != event2.target.uuid) return;

    let activeElectrodes;
    let microdrop = new MicropedeAsync(APPNAME, 'localhost', this.port);
    try {
      activeElectrodes = await this.getState('active-electrodes', 'electrodes-model');
    } catch (e) {
      activeElectrodes = [];
    }

    const id = event.target.name;
    let isOn = _.includes(activeElectrodes, id);

    // If shiftKey is down, unset selected electrode
    if (event.origDomEvent.shiftKey == true && this.selectedElectrode) {
      this.unselectElectrode();
    }

    // Toggle the state of the target electrode
    if (isOn == true) {
      this.turnOffElectrode(id);

      // If turning off selected electrode, then also unselect
      if (this.selectedElectrode){
        if (id == this.selectedElectrode.name) {
          this.unselectElectrode();
        }
      }
    } else {
      this.turnOnElectrode(id);
    }

    // If shift was pressed, select the target electrode
    if (event.origDomEvent.shiftKey == true) {
      this.selectElectrode(id);
    }
  }

}

const GetArea = function(group, electrode, ppi=96) {
  /* Calculate area of a polygon, and convert to mm */

  // Find object in group
  const obj = _.find(group.children, {name: electrode});
  // Return vertices in the z=0 plane
  const v = _.filter(_.get(obj, 'geometry.vertices'), (v) => v.z == 0);

  // Compute area based on a polygon constructed from the vertices
  const polygon = new Polygon(v);
  let area_ppi = Math.abs(polygon.area());

  // convert ppi to inches to mm:
  return area_ppi * (1 / (ppi*ppi)) * ((25.4*25.5)/1);
}

const FindAllNeighbours = function(group, object, maxDistance=MAX_DISTANCE) {
  const LABEL = "<ElectrodeControls::FindAllNeighbours>";

  /* Find neighbours in all directions */
  const neighbours = {};
  if (_.isString(object)) {object = _.filter(group.children, {name: object})[0]};
  for (const [k, dir] of Object.entries(DIRECTIONS)) {
    const n = FindNeighbourInDirection(group, object, dir, maxDistance);
    if (n) neighbours[dir] = n.id;
  }
  return neighbours;
}

const FindNeighbourInDirection = function(group, object, dir, maxDistance=MAX_DISTANCE) {
  const LABEL = "<ElectrodeControls::FindNeighbourInDirection>";

  /* Find neighbours in a particular direction */
  // XXX: Only returning first intersect (not 100% accuracte since multiple
  // electrodes can be in contact along one edge)
  if (_.isString(object)) {object = _.filter(group.children, {name: object})[0]};

  if (object == undefined) return undefined;
  const intersects = FindIntersectsInDirection(object, dir, group, maxDistance);
  const intersect = _.minBy(intersects, 'distance');
  if (!intersect) return undefined;

  const neighbour = {};
  neighbour.distance = intersect.distance;
  neighbour.object = intersect.object;
  neighbour.id = intersect.object.name;
  return neighbour;
}

function FindNearestIntersectFromEdge(objName, point, direction, group, maxDistance=MAX_DISTANCE) {
  const LABEL = "<ElectrodeControls::FindNearestIntersectFromEdge>";
  /* Find neighbour of an object along an edge normal to the rays direction */
  /*  objName: name of currentObject
      point: any point inside currentObject (changes start location along edge)
      direction: direction towards edge
      collisionObjects: list of possible objects to collide with
  */

  // Cast ray in direction (to find the edge)
  const raycaster = new THREE.Raycaster();
  raycaster.set(point, direction);

  // Filter the intersections for that of the current object (from objName);
  var intersects = raycaster.intersectObjects( group.children , true);
  var start = _.filter(intersects, {object: {name: objName}})[0];
  if (!start) return undefined;

  // Cast another ray from the objects edge, ignoring starting object
  raycaster.set(start.point, direction);
  var intersects = raycaster.intersectObjects( group.children , true);
  _.remove(intersects, {object: {name: objName}});
  _.remove(intersects, {distance: 0});
  // Return object with smallest distance from start object
  const intersect = _.min(intersects, "distance");  if (_.get(intersect, 'distance') > maxDistance) return undefined;
  return intersect;
}

function FindIntersectsInDirection(obj, dir, group, maxDistance=MAX_DISTANCE) {
  const LABEL = "<ElectrodeControls::FindIntersectsInDirection>";
  if (_.isString(obj)) {obj = _.filter(group.children, {name: object})[0]};

  /* Get all neighbouring objects around an objects axis*/
  let direction;
  if (dir == DIRECTIONS.RIGHT) direction = new THREE.Vector3(1,0,0);
  if (dir == DIRECTIONS.LEFT)  direction = new THREE.Vector3(-1,0,0);
  if (dir == DIRECTIONS.UP)    direction = new THREE.Vector3(0,1,0);
  if (dir == DIRECTIONS.DOWN)  direction = new THREE.Vector3(0,-1,0);

  // Get the origin of the selected electrode (accounting for displacement)
  const origin = new THREE.Vector3();
  origin.setFromMatrixPosition( obj.matrixWorld );

  obj.geometry.computeBoundingBox();
  const bbox   = obj.geometry.boundingBox;
  const width  = bbox.max.x - bbox.min.x;
  const height = bbox.max.y - bbox.min.y;

  const numSteps = 20;
  const intersects = {};

  var point = origin.clone();
  var n = obj.name;

  if (direction.y == 0) {
    point.y -= height/2;
    var step = height/numSteps;
    for (var i=0;i<numSteps;i++) {
      point.y += step;
      const intersect = FindNearestIntersectFromEdge(n, point, direction,
        group, maxDistance);
      if (!intersect) continue;
      const uuid = intersect.object.uuid;
      intersects[uuid] = intersect;
    }
  }
  else if (direction.x == 0) {
    point.x -= width/2;
    var step = width/numSteps;
    for (var i=0;i<numSteps;i++) {
      point.x += step;
      const intersect = FindNearestIntersectFromEdge(n, point, direction,
        group, maxDistance);
      if (!intersect) continue;
      const uuid = intersect.object.uuid;
      intersects[uuid] = intersect;
    }
  }
  return _.values(intersects);
}

module.exports = ElectrodeControls;
module.exports.SetConsole = MicrodropHelpers.SetConsole;
module.exports.ElectrodeControls = ElectrodeControls;
module.exports.FindAllNeighbours = FindAllNeighbours;
module.exports.FindNeighbourInDirection = FindNeighbourInDirection;
module.exports.GetArea = GetArea;
module.exports.MAX_DISTANCE = MAX_DISTANCE;
