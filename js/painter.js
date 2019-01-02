class BBPainter {
	constructor() {
		this.color = 0x0000ffff
		this.currentPixel = [-1, -1]
		this.brushChanges = false
		this.current = {/*texture, image*/}
		this.background_color = new ColorPicker({
			id: 'background_color',
			label: true,
			private: true,
		})
	}
	edit(texture, cb, options) {
		if (!options.no_undo) {
			Undo.initEdit({textures: [texture], bitmap: true})
		}
		var instance = Painter.current[options.method === 'canvas' ? 'canvas' : 'image']
		Painter.current[options.method === 'canvas' ? 'image' : 'canvas'] = undefined

		if (options.use_cache &&
			texture === Painter.current.texture &&
			typeof instance === 'object'
		) {
			//IS CACHED
			if (options.method !== 'canvas') {
				instance = cb(instance) || instance
			} else {
				cb(instance)
			}
			if (options.no_update === true) {
				return;
			}

			if (options.method !== 'canvas') {
				Painter.current.image.getBase64(Jimp.MIME_PNG, function(a, dataUrl){
					texture.updateSource(dataUrl)
					if (!options.no_undo) {
						Undo.finishEdit('edit_texture')
					}
				})
			} else {
				texture.updateSource(instance.toDataURL())
				if (!options.no_undo) {
					Undo.finishEdit('edit_texture')
				}
			}
		} else {
			if (options.method !== 'canvas') {
				Painter.current.texture = texture
				Jimp.read(Buffer.from(texture.source.replace('data:image/png;base64,', ''), 'base64')).then(function(image) {
					image = cb(image) || image
					Painter.current.image = image
					image.getBase64(Jimp.MIME_PNG, function(a, dataUrl){
						texture.updateSource(dataUrl)
						if (!options.no_undo) {
							Undo.finishEdit('edit_texture')
						}
					})
				})
			} else {
				Painter.current.texture = texture
				var c = Painter.current.canvas = document.createElement('canvas')
				var ctx = c.getContext('2d');
				c.width = texture.res;
				c.height = texture.img.naturalHeight;
				ctx.drawImage(texture.img, 0, 0)

				cb(c)

				texture.updateSource(c.toDataURL())
				if (!options.no_undo) {
					Undo.finishEdit('edit_texture')
				}
			}
		}
	}
	startBrushCanvas(data, event) {
		Painter.current.x = Painter.current.y = 0
		var texture = getTextureById(data.cube.faces[data.face].texture)
		if (!texture) {
			Blockbench.showQuickMessage('message.untextured')
		}
		if (texture) {
			var x = Math.floor( data.intersects[0].uv.x * texture.img.naturalWidth )
			var y = Math.floor( (1-data.intersects[0].uv.y) * texture.img.naturalHeight )
			Painter.startBrush(texture, x, y, data.cube.faces[data.face].uv, event)
		}
		if (Toolbox.selected.id !== 'color_picker' && texture) {
			document.addEventListener('mousemove', Painter.moveBrushCanvas, false );
			document.addEventListener('mouseup', Painter.stopBrushCanvas, false );
		}
	}
	moveBrushCanvas(force) {
		var data = Canvas.raycast()
		if (data) {
			var texture = getTextureById(data.cube.faces[data.face].texture)
			if (texture) {
				var x, y, new_face;
				var end_x = x = Math.floor( data.intersects[0].uv.x * texture.img.naturalWidth )
				var end_y = y = Math.floor( (1-data.intersects[0].uv.y) * texture.img.naturalHeight )
				if (x === Painter.current.x && y === Painter.current.y) {
					return
				}
				if (Painter.current.face !== data.face || Painter.current.cube !== data.cube) {
					Painter.current.x = x
					Painter.current.y = y
					Painter.current.face = data.face
					Painter.current.cube = data.cube
					new_face = true
					if (texture !== Painter.current.texture) {
						Undo.current_save.addTexture(texture)
					}
				}
				var diff = {
					x: x - (Painter.current.x||x),
					y: y - (Painter.current.y||y),
				}
				var length = Math.sqrt(diff.x*diff.x + diff.y*diff.y)
				if (new_face && !length) {
					length = 1
				}
				var i = 0;
				while (i < length) {
					x = end_x - diff.x / length * i
					y = end_y - diff.y / length * i
					Painter.useBrush(texture, x, y, data.cube.faces[data.face].uv, i < length-1)
					i++;
				}

				Painter.current.x = end_x
				Painter.current.y = end_y
			}
		}
	}
	stopBrushCanvas() {
		document.removeEventListener( 'mousemove', Painter.moveBrushCanvas, false );
		document.removeEventListener( 'mouseup', Painter.stopBrushCanvas, false );
		Painter.stopBrush()
	}
	startBrush(texture, x, y, uvTag, event) {
		if (Toolbox.selected.id !== 'color_picker') {
			Undo.initEdit({textures: [texture], bitmap: true})
			Painter.brushChanges = false
			Painter.useBrush(texture, x, y, uvTag)
			Painter.current.x = x;
			Painter.current.y = y;
		} else {
			Painter.colorPicker(texture, x, y)
		}
	}
	colorPicker(texture, x, y) {
		function getPxColor(image) {
			var c = image.getPixelColor(x,y)
			c = tinycolor(Jimp.intToRGBA(c))
			BarItems.brush_color.set(c)
		}
		if (texture.mode == 'bitmap') {
			Jimp.read(Buffer.from(texture.source.replace('data:image/png;base64,', ''), 'base64')).then(getPxColor)
		} else {
			Jimp.read(texture.source).then(getPxColor)
		}
	}
	useBrush(texture, x, y, uvTag, no_update) {
		if ((Painter.currentPixel[0] !== x || Painter.currentPixel[1] !== y)) {
			Painter.currentPixel = [x, y]
			Painter.brushChanges = true

			texture.edit(function(canvas) {
				var ctx = canvas.getContext('2d')
				ctx.save()

				var color = BarItems.brush_color.get().toRgb();//.toRgbString()
				var size = BarItems.slider_brush_size.get();
				var softness = BarItems.slider_brush_softness.get()/100;
				var b_opacity = BarItems.slider_brush_opacity.get()/100;
				var tool = Toolbox.selected.id;
				var noise = BarItems.brush_mode.get() == 'noise';

				ctx.beginPath();
				if (uvTag) {
					var rect = Painter.editing_area = [
						uvTag[0] / 16 * texture.img.naturalWidth,
						uvTag[1] / 16 * texture.img.naturalHeight,
						uvTag[2] / 16 * texture.img.naturalWidth,
						uvTag[3] / 16 * texture.img.naturalHeight
					]
				} else {
					var rect = Painter.editing_area = [0, 0, texture.red, texture.red]
				}
				for (var t = 0; t < 2; t++) {
					if (rect[t] > rect[t+2]) {
						[rect[t], rect[t+2]] = [rect[t+2], rect[t]]
					}
				}
				ctx.rect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1])

				if (tool === 'fill_tool') {

					ctx.fillStyle = BarItems.brush_color.get().toRgbString()
					ctx.fill()

				} else {
					ctx.clip()
					/*ctx.beginPath();
					ctx.moveTo((Painter.current.x||x)+.5, (Painter.current.y||y)+.5)
					ctx.lineTo(x+.5, y+.5)
					if (softness) {
						ctx.filter = `blur(${ softness*size/2 }px)`;
					} else {
						ctx.imageSmoothingEnabled = false
					}
					ctx.lineWidth = size
					ctx.lineCap = 'round'
					if (brush_mode === 'eraser') {
						ctx.globalCompositeOperation = 'destination-out'
						ctx.strokeStyle = 'rgba(0,0,0,0)';
					} else {
						ctx.strokeStyle = color
					}
					ctx.stroke()*/
					if (tool === 'brush_tool') {
						Painter.editCircle(ctx, x, y, size, softness, function(pxcolor, opacity) {
							var result_color = Painter.combineColors(pxcolor, color, opacity*b_opacity*(noise?Math.random():1));
							return result_color;
						})
					} else if (tool === 'eraser') {
						Painter.editCircle(ctx, x, y, size, softness, function(pxcolor, opacity) {
							return {r: pxcolor.r, g: pxcolor.g, b: pxcolor.b, a: pxcolor.a*(1-b_opacity*opacity*(noise?Math.random():1))};
						})
					}

					ctx.restore();
				}
				Painter.editing_area = undefined;

			}, {method: 'canvas', no_undo: true, use_cache: true, no_update: no_update});
		}
	}
	stopBrush() {
		if (Painter.brushChanges) {
			Undo.finishEdit('paint');
			Painter.brushChanges = false;
		}
		Painter.currentPixel = [-1, -1];
	}
	combineColors(base, added, opacity) {
		if (typeof base === 'number') base = Jimp.intToRGBA(base)
		if (typeof added === 'number') added = Jimp.intToRGBA(added)

		var original_a = added.a
		added.a = (added.a)*opacity

		var mix = {};
		mix.a = limitNumber(1 - (1 - added.a) * (1 - base.a), 0, 1); // alpha
		mix.r = Math.round((added.r * added.a / mix.a) + (base.r * base.a * (1 - added.a) / mix.a)); // red
		mix.g = Math.round((added.g * added.a / mix.a) + (base.g * base.a * (1 - added.a) / mix.a)); // green
		mix.b = Math.round((added.b * added.a / mix.a) + (base.b * base.a * (1 - added.a) / mix.a)); // blue

		added.a = original_a
		return mix;
	}
	scanCanvas(ctx, x, y, w, h, cb) {
		var arr = ctx.getImageData(x, y, w, h)
		for (var i = 0; i < arr.data.length; i += 4) {
			var pixel = arr.data.slice(i, i+4)

			var px = (i/4) % w
			var py = Math.floor((i/4) / w)
			pixel = cb(x+px, y+py, pixel)||pixel

			pixel.forEach((p, pi) => {
				arr.data[i+pi] = p
			})
		}
		ctx.putImageData(arr, x, y)
	}
	drawRectangle(image, color, rect) {
		var color = Jimp.intToRGBA(color)
		image.scan(rect.x, rect.y, rect.w, rect.h, function (x, y, idx) {
			this.bitmap.data[idx + 0] = color.r
			this.bitmap.data[idx + 1] = color.g
			this.bitmap.data[idx + 2] = color.b
			this.bitmap.data[idx + 3] = color.a
		});
	}
	editFace(image, x, y, editPx) {
		var x = Math.floor(Painter.editing_area[0]-0.5)
		var y = Math.floor(Painter.editing_area[1]-0.5)
		var width  = Math.floor(Painter.editing_area[2]+1.5) - Math.floor(Painter.editing_area[0])
		var height = Math.floor(Painter.editing_area[3]+1.5) - Math.floor(Painter.editing_area[1])
		image.scan(x, y, width, height, function (px, py, idx) {

			if (px >= this.bitmap.width ||
				px < 0 ||
				py >= this.bitmap.height ||
				py < 0
			) {
				return;
			}
			if (
				typeof Painter.editing_area === 'object' &&
				(
					px+0.2 < Painter.editing_area[0] ||
					py+0.2 < Painter.editing_area[1] ||
					px+0.2 >= Painter.editing_area[2] ||
					py+0.2 >= Painter.editing_area[3] 
				)
			) {
				return;
			}

			var result_color = editPx({
				r:this.bitmap.data[idx+0],
				g:this.bitmap.data[idx+1],
				b:this.bitmap.data[idx+2],
				a:this.bitmap.data[idx+3]/255
			})
			this.bitmap.data[idx+0] = result_color.r
			this.bitmap.data[idx+1] = result_color.g
			this.bitmap.data[idx+2] = result_color.b
			this.bitmap.data[idx+3] = result_color.a*255

		});
	}
	editCircle(ctx, x, y, r, s, editPx) {
		r = Math.round(r)

		Painter.scanCanvas(ctx, x-r-1, y-r-1, 2*r+3, 2*r+3, function (px, py, pixel) {


			if (px >= ctx.canvas.width ||
				px < 0 ||
				py >= ctx.canvas.height ||
				py < 0
			) {
				return;
			}
			if (
				settings.paint_side_restrict.value &&
				Painter.editing_area && 
				typeof Painter.editing_area === 'object' &&
				(
					px+0.02 < Math.floor(Painter.editing_area[0]) ||
					py+0.02 < Math.floor(Painter.editing_area[1]) ||
					px+0.02 >= Painter.editing_area[2] ||
					py+0.02 >= Painter.editing_area[3]
				)
			) {
				return;
			}

			px -= x;
			py -= y;

			var distance = Math.sqrt(px*px + py*py)
			if (s*r != 0) {
				var pos_on_gradient = (distance-(1-s)*r) / (s*r)
			} else {
				var pos_on_gradient = Math.floor(distance/r)
			}

			var opacity = limitNumber(1-pos_on_gradient, 0, 1)

			if (opacity > 0) {
				var result_color = editPx({
					r: pixel[0],
					g: pixel[1],
					b: pixel[2],
					a: pixel[3]/255
				}, opacity)
				pixel[0] = result_color.r
				pixel[1] = result_color.g
				pixel[2] = result_color.b
				pixel[3] = result_color.a*255
			}
		});
	}
	drawRotatedRectangle(image, color, rect, cx, cy, angle) {
		var color = Jimp.intToRGBA(color)
		var sin = Math.sin(-Math.degToRad(angle))
		var cos = Math.cos(-Math.degToRad(angle))
		function rotatePoint(px, py) {
			px -= cx
			py -= cy
			return {
				x: (px * cos - py * sin) + cx,
				y: (px * sin + py * cos) + cy
			}
		}
		image.scan(0, 0, 48, 48, function (px, py, idx) {
			var rotated = rotatePoint(px, py)
			if (
				rotated.x > rect.x-1 && rotated.x < rect.x + rect.w+2 &&
				rotated.y > rect.y-1 && rotated.y < rect.y + rect.h+2 
			) {
				var opacity = 	limitNumber(rect.x - rotated.x, 0, 1) +
								limitNumber(rotated.x - (rect.x + rect.w), 0, 1) +
								limitNumber(rect.y - rotated.y, 0, 1) +
								limitNumber(rotated.y - (rect.y + rect.h), 0, 1)

				opacity = 1-limitNumber(opacity*1.61, 0, 1)
				if (this.bitmap.data[idx + 3]) {
					opacity = 1
				}

				this.bitmap.data[idx + 0] = color.r
				this.bitmap.data[idx + 1] = color.g
				this.bitmap.data[idx + 2] = color.b
				this.bitmap.data[idx + 3] = color.a*opacity
			}
		})
	}
	addBitmapDialog() {
		var lines = []

		lines.push({label: 'dialog.create_texture.name', node: '<input class="dark_bordered half" type="text" id="bitmap_name">'})
		lines.push({label: 'dialog.create_texture.folder', node: '<input class="dark_bordered half" type="text" id="bitmap_folder">'})
		if (elements.length > 0) {
			lines.push({label: 'dialog.create_texture.template', node: '<input type="checkbox" id="bitmap_doTemplate">'})
		}
		lines.push({widget: Painter.background_color})
		lines.push({label: 'dialog.create_texture.resolution', node: '<input class="dark_bordered" style="width:72px" type="number" id="bitmap_resolution">'})


		var dialog = new Dialog({
			id: 'add_bitmap',
			title: tl('dialog.create_texture.title'),
			draggable: true,
			lines: lines,
			onConfirm: function() {
				Painter.addBitmapFromDialog()
				dialog.hide()
			}
		})
		dialog.show()
		$('.dialog#add_bitmap input#bitmap_doTemplate').click(function() {
			if (Painter.background_color.get().toHex8() === 'ffffffff') {
				Painter.background_color.set('#00000000')
			}
		})
	}
	testSetup() {
		Painter.addBitmap()
		main_uv.setFace('up')
		addCube().extend({to:[16,1,16]})
		elements[0].faces.up.uv = [0,0,16,16]
		textures[0].apply()
		Canvas.updateSelected()
		updateSelection()
	}
	addBitmapFromDialog() {
		var color = Painter.background_color.get()

		Painter.addBitmap({
			res: limitNumber(parseInt($('.dialog#add_bitmap input#bitmap_resolution').val()), 16, 2048),
			color: color,
			name: $('.dialog#add_bitmap input#bitmap_name').val(),
			folder: $('.dialog#add_bitmap input#bitmap_folder').val(),
			particle: 'auto',
			entity_template: $('.dialog#add_bitmap input#bitmap_doTemplate').is(':checked')
		})
	}
	addBitmap(options, after) {
		if (typeof options !== 'object') {
			options = {}
		}
		if (isNaN(options.res) || !options.res) {
			options.res = 16
		}
		if (options.color === undefined) {
			options.color = new tinycolor().toRgb()
		}
		if (Blockbench.entity_mode) {
			options.texture = textures[0]
		}
		var texture = new Texture({
			mode: 'bitmap',
			keep_size: true,
			res: options.res,
			name: options.name ? options.name : 'texture',
			folder: options.folder ? options.folder : 'blocks'
		})
		function makeTexture(dataUrl) {
			texture.fromDataURL(dataUrl)
			switch (options.particle) {
				case 'auto':
				texture.fillParticle();
				break;
				case true:
				texture.enableParticle();
				break;
			}
			if (typeof after === 'function') {
				after(texture)
			}
			return texture.add(false);
		}
		if (options.entity_template === true) {
			Undo.initEdit({textures: [], cubes: Blockbench.entity_mode ? elements : selected, uv_only: true})
			Painter.generateTemplate(options.res, options.color, makeTexture, options.texture)
			Undo.finishEdit({textures: [texture], cubes: Blockbench.entity_mode ? elements : selected, uv_only: true})
		} else {
			Undo.initEdit({textures: []})
			Painter.generateBlank(options.res, options.res, options.color, makeTexture)
			Undo.finishEdit({textures: [texture]})
		}
	}
	generateBlank(height, width, color, cb) {
		var canvas = document.createElement('canvas')
		canvas.width = width;
		canvas.height = height;
		var ctx = canvas.getContext('2d')

		ctx.fillStyle = new tinycolor(color).toRgbString()
		ctx.fillRect(0, 0, width, height)

		cb(canvas.toDataURL())

	}
	generateTemplate(res, background_color, cb, texture) {
		function cubeTempl(obj) {
			var min = Blockbench.entity_mode ? 0 : 1
			this.x = obj.size(0, true) || min
			this.y = obj.size(1, true) || min
			this.z = obj.size(2, true) || min
			this.obj = obj

			this.height = this.z + this.y
			this.width = 2* (this.x + this.z)
			return this;
		}

		var res_multiple = res / 16
		var templates = []
		var max_x_pos = 0
		var line_y_pos = 0;
		var valid_cubes = 0;

		var lines = [[]]
		var line_length = Math.sqrt(elements.length/2)
		var o = 0

		var cubes = Blockbench.entity_mode ? elements.slice() : selected.slice()
		var avg_size = 0;

		var i = cubes.length-1
		while (i >= 0) {
			let obj = cubes[i]
			if (obj.visibility === false) {
				cubes.splice(i,1)
			} else {
				obj.template_size = (obj.size(2, true) + obj.size(1, true)) + (obj.size(2, true) + obj.size(0, true))*2
				avg_size += obj.template_size
			}
			i--;
		}
		avg_size /= cubes.length
		cubes.sort(function(a,b) {
			return b.template_size - a.template_size
		})

		i = 0
		var ox = 0
		cubes.forEach(function(obj) {
			if (ox >= line_length) {
				o = 0
				ox = 0
				i++
				lines[i] = []
			}
			lines[i][o] = obj
			o++;
			ox += obj.template_size/avg_size
		})

		lines.forEach(function(b) {

			//Data
			var temps = []
			b.forEach(function(s, si) {
				if (s.type === 'cube') {
					temps.push(new cubeTempl(s))
					valid_cubes++;
				}
			})
			//Defaults
			//Find the maximum height of the line
			var max_height = 0
			temps.forEach(function(t) {
				max_height = Math.max(max_height, t.height)
			})
			var x_pos = 0
			var y_pos = 0 //Y Position of current area relative to this bone
			var filled_x_pos = 0;
			//Algorithm
			temps.forEach(function(t) {
				if (y_pos > 0 && (y_pos + t.height) <= max_height) {
					//same column
					t.posx = x_pos
					t.posy = y_pos + line_y_pos
					filled_x_pos = Math.max(filled_x_pos, x_pos+t.width)
					y_pos += t.height
				} else {
					//new column
					x_pos = filled_x_pos
					y_pos = t.height
					t.posx = x_pos
					t.posy = line_y_pos
					filled_x_pos = Math.max(filled_x_pos, x_pos+t.width)
				}
				//size of widest bone
				max_x_pos = Math.max(max_x_pos, filled_x_pos)
				templates.push(t)
			})
			line_y_pos += max_height
		})
		//Cancel if no cubes
		if (valid_cubes == 0) {
			Blockbench.showMessage('No valid cubes', 'center')
			return;
		}
		function getNextPower(num, min) {
			var i = min ? min : 2
			while (i < num && i < 4000) {
				i *= 2
			}
			return i;
		}
		//Size
		var max_size = Math.max(max_x_pos, line_y_pos)
		max_size = Math.ceil(max_size/16)*16//getNextPower(max_size, 16)

		if (background_color.getAlpha() != 0) {
			background_color = background_color.toInteger()
		}
		var canvas = document.createElement('canvas')
		canvas.width = canvas.height = max_size*res_multiple;
		var ctx = canvas.getContext('2d')
		ctx.imageSmoothingEnabled = false;

		
		function drawTemplateRectangle(border_color, color, coords) {
			if (typeof background_color === 'number') {
				border_color = background_color
				color = undefined
			}
			ctx.fillStyle = border_color
			ctx.fillRect(
				coords.x*res_multiple,
				coords.y*res_multiple,
				coords.w*res_multiple,
				coords.h*res_multiple
			)
			if (coords.w <= 2 || coords.h <= 2 || !color) return;

			ctx.fillStyle = color
			ctx.fillRect(
				coords.x * res_multiple + 1,
				coords.y * res_multiple + 1,
				coords.w * res_multiple - 2,
				coords.h * res_multiple - 2
			)
		}
		function drawTexture(face, coords) {
			if (!Blockbench.entity_mode) {
				if (face.texture === undefined || face.texture === null) return false;
				texture = getTextureById(face.texture)
			}
			if (!texture || !texture.img) return false;
			var uv = face.uv;
			var src = getRectangle(uv[0], uv[1], uv[2], uv[3])
			ctx.drawImage(
				texture.img,
				src.ax/16 * texture.img.naturalWidth,
				src.ay/16 * texture.img.naturalHeight,
				src.x /16 * texture.img.naturalWidth,
				src.y /16 * texture.img.naturalHeight,
				coords.x*res_multiple,
				coords.y*res_multiple,
				coords.w*res_multiple,
				coords.h*res_multiple
			)
			return true;
		}

		var face_data = {
			up:		{c1: '#b4d4e1', c2: '#ecf8fd', place: t => {return {x: t.posx+t.z, 		y: t.posy, 		w: t.x, 	h: t.z}}},
			down:	{c1: '#536174', c2: '#6e788c', place: t => {return {x: t.posx+t.z+t.x, 	y: t.posy, 		w: t.x, 	h: t.z}}},
			east:	{c1: '#43e88d', c2: '#7BFFA3', place: t => {return {x: t.posx, 			y: t.posy+t.z, 	w: t.z, 	h: t.y}}},
			north:	{c1: '#5bbcf4', c2: '#7BD4FF', place: t => {return {x: t.posx+t.z, 		y: t.posy+t.z, 	w: t.x, 	h: t.y}}},
			west:	{c1: '#f48686', c2: '#FFA7A4', place: t => {return {x: t.posx+t.z+t.x, 	y: t.posy+t.z, 	w: t.z, 	h: t.y}}},
			south:	{c1: '#f8dd72', c2: '#FFF899', place: t => {return {x: t.posx+t.z+t.x+t.z,y: t.posy+t.z, 	w: t.x, 	h: t.y}}},
		}

		//Drawing

		templates.forEach(function(t) {
			for (var face in face_data) {
				let d = face_data[face]
				
				if (!t.obj.faces[face].texture ||
					!drawTexture(t.obj.faces[face], d.place(t))
				) {
					drawTemplateRectangle(d.c1, d.c2, d.place(t))
				}
			}
			let obj = t.obj
			obj.uv_offset[0] = t.posx
			obj.uv_offset[1] = t.posy

			if (!Blockbench.entity_mode) {
				var size = obj.size(undefined, true)
				
				var face_list = [   
					{face: 'north', fIndex: 10,	from: [size[2], size[2]],			 	size: [size[0],  size[1]]},
					{face: 'east', fIndex: 0,	from: [0, size[2]],				   		size: [size[2],  size[1]]},
					{face: 'south', fIndex: 8,	from: [size[2]*2 + size[0], size[2]], 	size: [size[0],  size[1]]},
					{face: 'west', fIndex: 2,	from: [size[2] + size[0], size[2]],   	size: [size[2],  size[1]]},
					{face: 'up', fIndex: 4,		from: [size[2]+size[0], size[2]],	 	size: [-size[0], -size[2]]},
					{face: 'down', fIndex: 6,	from: [size[2]+size[0]*2, 0],		 	size: [-size[0], size[2]]}
				]

				face_list.forEach(function(f) {

					obj.faces[f.face].uv[0] = (f.from[0]			 + 	Math.floor(obj.uv_offset[0]+0.0000001)) / max_size  * 16,
					obj.faces[f.face].uv[1] = (f.from[1]			 + 	Math.floor(obj.uv_offset[1]+0.0000001)) / max_size * 16,
					obj.faces[f.face].uv[2] = (f.from[0] + f.size[0] + 	Math.floor(obj.uv_offset[0]+0.0000001)) / max_size  * 16,
					obj.faces[f.face].uv[3] = (f.from[1] + f.size[1] + 	Math.floor(obj.uv_offset[1]+0.0000001)) / max_size * 16

				})
			}
		})
		var dataUrl = canvas.toDataURL()
		var texture = cb(dataUrl)
		entityMode.setResolution(max_size, max_size, true)
		if (texture && !Blockbench.entity_mode) {
			templates.forEach(function(t) {
				t.obj.applyTexture(texture, true)
				t.obj.autouv = 0
			})
		}
	}
}
var Painter = new BBPainter()

BARS.defineActions(function() {

	new Tool({
		id: 'brush_tool',
		icon: 'fa-paint-brush',
		category: 'tools',
		toolbar: 'brush',
		alt_tool: 'color_picker',
		selectFace: true,
		transformerMode: 'hidden',
		paintTool: true,
		allowWireframe: false,
		keybind: new Keybind({key: 66}),
		modes: ['paint'],
		onCanvasClick: function(data) {
			Painter.startBrushCanvas(data, data.event)
		},
		onSelect: function() {
			BarItems.slider_brush_size.update()
			BarItems.slider_brush_softness.update()
			BarItems.slider_brush_opacity.update()
			$('.UVEditor').find('#uv_size').hide()
		},
		onUnselect: function() {
			$('.UVEditor').find('#uv_size').show()
		}
	})
	new Tool({
		id: 'fill_tool',
		icon: 'format_color_fill',
		category: 'tools',
		toolbar: 'brush',
		alt_tool: 'color_picker',
		selectFace: true,
		transformerMode: 'hidden',
		paintTool: true,
		allowWireframe: false,
		modes: ['paint'],
		onCanvasClick: function(data) {
			Painter.startBrushCanvas(data, data.event)
		},
		onSelect: function() {
			BarItems.slider_brush_size.update()
			BarItems.slider_brush_softness.update()
			BarItems.slider_brush_opacity.update()
			$('.UVEditor').find('#uv_size').hide()
		},
		onUnselect: function() {
			$('.UVEditor').find('#uv_size').show()
		}
	})
	new Tool({
		id: 'eraser',
		icon: 'fa-eraser',
		category: 'tools',
		toolbar: 'brush',
		selectFace: true,
		transformerMode: 'hidden',
		paintTool: true,
		allowWireframe: false,
		modes: ['paint'],
		onCanvasClick: function(data) {
			Painter.startBrushCanvas(data, data.event)
		},
		onSelect: function() {
			BarItems.slider_brush_size.update()
			BarItems.slider_brush_softness.update()
			BarItems.slider_brush_opacity.update()
			$('.UVEditor').find('#uv_size').hide()
		},
		onUnselect: function() {
			$('.UVEditor').find('#uv_size').show()
		}
	})
	new Tool({
		id: 'color_picker',
		icon: 'colorize',
		category: 'tools',
		toolbar: 'brush',
		selectFace: true,
		transformerMode: 'hidden',
		paintTool: true,
		allowWireframe: false,
		modes: ['paint'],
		onCanvasClick: function(data) {
			Painter.startBrushCanvas(data, data.event)
		},
		onSelect: function() {
			BarItems.slider_brush_size.update()
			BarItems.slider_brush_softness.update()
			BarItems.slider_brush_opacity.update()
			$('.UVEditor').find('#uv_size').hide()
		},
		onUnselect: function() {
			$('.UVEditor').find('#uv_size').show()
		}
	})

	new ColorPicker({
		id: 'brush_color',
		condition: () => (Toolbox && ['brush_tool', 'color_picker', 'fill_tool'].includes(Toolbox.selected.id)),
		palette: true
	})
	new BarSelect({
		id: 'brush_mode',
		condition: () => Toolbox && (Toolbox.selected.id === 'brush_tool' || Toolbox.selected.id === 'eraser'),
		options: {
			brush: true,
			noise: true
		}
	})

	new NumSlider({
		id: 'slider_brush_size',
		condition: () => (Toolbox && ['brush_tool', 'eraser'].includes(Toolbox.selected.id)),
		settings: {
			min: 1, max: 20, step: 1, default: 1,
		}
	})
	new NumSlider({
		id: 'slider_brush_softness',
		condition: () => (Toolbox && ['brush_tool', 'eraser'].includes(Toolbox.selected.id)),
		settings: {
			min: 0, max: 100, default: 0,
			interval: function(event) {
				if (event.shiftKey && event.ctrlKey) {
					return 0.25;
				} else if (event.shiftKey) {
					return 5;
				} else if (event.ctrlKey) {
					return 1;
				} else {
					return 10;
				}
			}
		}
	})
	new NumSlider({
		id: 'slider_brush_opacity',
		condition: () => (Toolbox && ['brush_tool', 'eraser'].includes(Toolbox.selected.id)),
		settings: {
			min: 0, max: 100, default: 100,
			interval: function(event) {
				if (event.shiftKey && event.ctrlKey) {
					return 0.25;
				} else if (event.shiftKey) {
					return 5;
				} else if (event.ctrlKey) {
					return 1;
				} else {
					return 10;
				}
			}
		}
	})
})