(function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function create_slot(definition, ctx, $$scope, fn) {
        if (definition) {
            const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
            return definition[0](slot_ctx);
        }
    }
    function get_slot_context(definition, ctx, $$scope, fn) {
        return definition[1] && fn
            ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
            : $$scope.ctx;
    }
    function get_slot_changes(definition, $$scope, dirty, fn) {
        if (definition[2] && fn) {
            const lets = definition[2](fn(dirty));
            if ($$scope.dirty === undefined) {
                return lets;
            }
            if (typeof lets === 'object') {
                const merged = [];
                const len = Math.max($$scope.dirty.length, lets.length);
                for (let i = 0; i < len; i += 1) {
                    merged[i] = $$scope.dirty[i] | lets[i];
                }
                return merged;
            }
            return $$scope.dirty | lets;
        }
        return $$scope.dirty;
    }
    function update_slot_base(slot, slot_definition, ctx, $$scope, slot_changes, get_slot_context_fn) {
        if (slot_changes) {
            const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
            slot.p(slot_context, slot_changes);
        }
    }
    function get_all_dirty_from_scope($$scope) {
        if ($$scope.ctx.length > 32) {
            const dirty = [];
            const length = $$scope.ctx.length / 32;
            for (let i = 0; i < length; i++) {
                dirty[i] = -1;
            }
            return dirty;
        }
        return -1;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function to_number(value) {
        return value === '' ? null : +value;
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.data === data)
            return;
        text.data = data;
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }
    function set_style(node, key, value, important) {
        if (value == null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * Schedules a callback to run immediately after the component has been updated.
     *
     * The first time the callback runs will be after the initial `onMount`
     */
    function afterUpdate(fn) {
        get_current_component().$$.after_update.push(fn);
    }
    /**
     * Schedules a callback to run immediately before the component is unmounted.
     *
     * Out of `onMount`, `beforeUpdate`, `afterUpdate` and `onDestroy`, this is the
     * only one that runs inside a server-side component.
     *
     * https://svelte.dev/docs#run-time-svelte-ondestroy
     */
    function onDestroy(fn) {
        get_current_component().$$.on_destroy.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    let render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = /* @__PURE__ */ Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function add_flush_callback(fn) {
        flush_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        // Do not reenter flush while dirty components are updated, as this can
        // result in an infinite loop. Instead, let the inner flush handle it.
        // Reentrancy is ok afterwards for bindings etc.
        if (flushidx !== 0) {
            return;
        }
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            try {
                while (flushidx < dirty_components.length) {
                    const component = dirty_components[flushidx];
                    flushidx++;
                    set_current_component(component);
                    update(component.$$);
                }
            }
            catch (e) {
                // reset dirty state to not end up in a deadlocked state and then rethrow
                dirty_components.length = 0;
                flushidx = 0;
                throw e;
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    /**
     * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
     */
    function flush_render_callbacks(fns) {
        const filtered = [];
        const targets = [];
        render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
        targets.forEach((c) => c());
        render_callbacks = filtered;
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }
    function outro_and_destroy_block(block, lookup) {
        transition_out(block, 1, 1, () => {
            lookup.delete(block.key);
        });
    }
    function update_keyed_each(old_blocks, dirty, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block, next, get_context) {
        let o = old_blocks.length;
        let n = list.length;
        let i = o;
        const old_indexes = {};
        while (i--)
            old_indexes[old_blocks[i].key] = i;
        const new_blocks = [];
        const new_lookup = new Map();
        const deltas = new Map();
        const updates = [];
        i = n;
        while (i--) {
            const child_ctx = get_context(ctx, list, i);
            const key = get_key(child_ctx);
            let block = lookup.get(key);
            if (!block) {
                block = create_each_block(key, child_ctx);
                block.c();
            }
            else if (dynamic) {
                // defer updates until all the DOM shuffling is done
                updates.push(() => block.p(child_ctx, dirty));
            }
            new_lookup.set(key, new_blocks[i] = block);
            if (key in old_indexes)
                deltas.set(key, Math.abs(i - old_indexes[key]));
        }
        const will_move = new Set();
        const did_move = new Set();
        function insert(block) {
            transition_in(block, 1);
            block.m(node, next);
            lookup.set(block.key, block);
            next = block.first;
            n--;
        }
        while (o && n) {
            const new_block = new_blocks[n - 1];
            const old_block = old_blocks[o - 1];
            const new_key = new_block.key;
            const old_key = old_block.key;
            if (new_block === old_block) {
                // do nothing
                next = new_block.first;
                o--;
                n--;
            }
            else if (!new_lookup.has(old_key)) {
                // remove old block
                destroy(old_block, lookup);
                o--;
            }
            else if (!lookup.has(new_key) || will_move.has(new_key)) {
                insert(new_block);
            }
            else if (did_move.has(old_key)) {
                o--;
            }
            else if (deltas.get(new_key) > deltas.get(old_key)) {
                did_move.add(new_key);
                insert(new_block);
            }
            else {
                will_move.add(old_key);
                o--;
            }
        }
        while (o--) {
            const old_block = old_blocks[o];
            if (!new_lookup.has(old_block.key))
                destroy(old_block, lookup);
        }
        while (n)
            insert(new_blocks[n - 1]);
        run_all(updates);
        return new_blocks;
    }

    function bind(component, name, callback) {
        const index = component.$$.props[name];
        if (index !== undefined) {
            component.$$.bound[index] = callback;
            callback(component.$$.ctx[index]);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            flush_render_callbacks($$.after_update);
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    const character = () => ({
        name: '',
        level: 1,
        experience: 0,
        hp: {
            current: 0,
            max: 0
        },
        abilities: {
            strength: 0,
            dexterity: 0,
            constitution: 0,
            wisdom: 0,
            intelligence: 0,
            charisma: 0
        },
        equipment: [],
        wounds: [],
        info: '',
        notes: []
    });

    const params = new URLSearchParams(window.location.search);
    const theme = params.get('theme') ?? 
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    function setTheme(name) {
        window.location.search = `theme=${name}`;
    }

    /* src\components\TextArea.svelte generated by Svelte v3.59.2 */

    function get_each_context$3(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[15] = list[i];
    	child_ctx[17] = i;
    	return child_ctx;
    }

    // (33:0) {:else}
    function create_else_block$4(ctx) {
    	let span;
    	let t;
    	let button;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*#slots*/ ctx[10].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[9], null);

    	function select_block_type_1(ctx, dirty) {
    		if (/*matches*/ ctx[1].length == 0) return create_if_block_1$2;
    		return create_else_block_1$1;
    	}

    	let current_block_type = select_block_type_1(ctx);
    	let if_block = current_block_type(ctx);

    	return {
    		c() {
    			span = element("span");
    			if (default_slot) default_slot.c();
    			t = space();
    			button = element("button");
    			if_block.c();
    			attr(span, "class", "py-2 font-weight-bold");
    			attr(button, "class", "btn btn-light border text-left align-top wrap w-100");
    			set_style(button, "min-height", "2.5em");
    		},
    		m(target, anchor) {
    			insert(target, span, anchor);

    			if (default_slot) {
    				default_slot.m(span, null);
    			}

    			insert(target, t, anchor);
    			insert(target, button, anchor);
    			if_block.m(button, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen(button, "click", /*click_handler*/ ctx[14]);
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 512)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[9],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[9])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[9], dirty, null),
    						null
    					);
    				}
    			}

    			if (current_block_type === (current_block_type = select_block_type_1(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(button, null);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(span);
    			if (default_slot) default_slot.d(detaching);
    			if (detaching) detach(t);
    			if (detaching) detach(button);
    			if_block.d();
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (24:0) {#if active}
    function create_if_block$6(ctx) {
    	let span;
    	let t;
    	let textarea;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*#slots*/ ctx[10].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[9], null);

    	return {
    		c() {
    			span = element("span");
    			if (default_slot) default_slot.c();
    			t = space();
    			textarea = element("textarea");
    			attr(span, "class", "py-2 font-weight-bold");
    			attr(textarea, "class", "flex-grow-1 form-control");
    		},
    		m(target, anchor) {
    			insert(target, span, anchor);

    			if (default_slot) {
    				default_slot.m(span, null);
    			}

    			insert(target, t, anchor);
    			insert(target, textarea, anchor);
    			/*textarea_binding*/ ctx[11](textarea);
    			set_input_value(textarea, /*content*/ ctx[0]);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(textarea, "input", /*textarea_input_handler*/ ctx[12]),
    					listen(textarea, "blur", /*blur_handler*/ ctx[13]),
    					listen(textarea, "focus", /*resizeInput*/ ctx[6]),
    					listen(textarea, "keyup", /*resizeInput*/ ctx[6])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 512)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[9],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[9])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[9], dirty, null),
    						null
    					);
    				}
    			}

    			if (dirty & /*content*/ 1) {
    				set_input_value(textarea, /*content*/ ctx[0]);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(span);
    			if (default_slot) default_slot.d(detaching);
    			if (detaching) detach(t);
    			if (detaching) detach(textarea);
    			/*textarea_binding*/ ctx[11](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (38:4) {:else}
    function create_else_block_1$1(ctx) {
    	let each_1_anchor;
    	let each_value = /*matches*/ ctx[1];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$3(get_each_context$3(ctx, each_value, i));
    	}

    	return {
    		c() {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			each_1_anchor = empty();
    		},
    		m(target, anchor) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				if (each_blocks[i]) {
    					each_blocks[i].m(target, anchor);
    				}
    			}

    			insert(target, each_1_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*content, matches, lastFragment, firstFragment*/ 51) {
    				each_value = /*matches*/ ctx[1];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$3(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$3(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		d(detaching) {
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(each_1_anchor);
    		}
    	};
    }

    // (36:4) {#if matches.length == 0}
    function create_if_block_1$2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text(/*content*/ ctx[0]);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*content*/ 1) set_data(t, /*content*/ ctx[0]);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (40:12) {#if i == 0}
    function create_if_block_3(ctx) {
    	let t;

    	return {
    		c() {
    			t = text(/*firstFragment*/ ctx[5]);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*firstFragment*/ 32) set_data(t, /*firstFragment*/ ctx[5]);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (40:183) {:else}
    function create_else_block_2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text(/*lastFragment*/ ctx[4]);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*lastFragment*/ 16) set_data(t, /*lastFragment*/ ctx[4]);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (40:83) {#if i < matches.length - 1}
    function create_if_block_2(ctx) {
    	let t_value = /*content*/ ctx[0].substring(/*match*/ ctx[15].index + /*match*/ ctx[15][0].length, /*matches*/ ctx[1][/*i*/ ctx[17] + 1].index) + "";
    	let t;

    	return {
    		c() {
    			t = text(t_value);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*content, matches*/ 3 && t_value !== (t_value = /*content*/ ctx[0].substring(/*match*/ ctx[15].index + /*match*/ ctx[15][0].length, /*matches*/ ctx[1][/*i*/ ctx[17] + 1].index) + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (39:8) {#each matches as match, i}
    function create_each_block$3(ctx) {
    	let span;
    	let t_value = /*match*/ ctx[15][0] + "";
    	let t;
    	let if_block1_anchor;
    	let if_block0 = /*i*/ ctx[17] == 0 && create_if_block_3(ctx);

    	function select_block_type_2(ctx, dirty) {
    		if (/*i*/ ctx[17] < /*matches*/ ctx[1].length - 1) return create_if_block_2;
    		return create_else_block_2;
    	}

    	let current_block_type = select_block_type_2(ctx);
    	let if_block1 = current_block_type(ctx);

    	return {
    		c() {
    			if (if_block0) if_block0.c();
    			span = element("span");
    			t = text(t_value);
    			if_block1.c();
    			if_block1_anchor = empty();
    			attr(span, "class", "bg-info");
    		},
    		m(target, anchor) {
    			if (if_block0) if_block0.m(target, anchor);
    			insert(target, span, anchor);
    			append(span, t);
    			if_block1.m(target, anchor);
    			insert(target, if_block1_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (/*i*/ ctx[17] == 0) if_block0.p(ctx, dirty);
    			if (dirty & /*matches*/ 2 && t_value !== (t_value = /*match*/ ctx[15][0] + "")) set_data(t, t_value);

    			if (current_block_type === (current_block_type = select_block_type_2(ctx)) && if_block1) {
    				if_block1.p(ctx, dirty);
    			} else {
    				if_block1.d(1);
    				if_block1 = current_block_type(ctx);

    				if (if_block1) {
    					if_block1.c();
    					if_block1.m(if_block1_anchor.parentNode, if_block1_anchor);
    				}
    			}
    		},
    		d(detaching) {
    			if (if_block0) if_block0.d(detaching);
    			if (detaching) detach(span);
    			if_block1.d(detaching);
    			if (detaching) detach(if_block1_anchor);
    		}
    	};
    }

    function create_fragment$f(ctx) {
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;
    	const if_block_creators = [create_if_block$6, create_else_block$4];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*active*/ ctx[2]) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_blocks[current_block_type_index].m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(if_block_anchor.parentNode, if_block_anchor);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if_blocks[current_block_type_index].d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance$f($$self, $$props, $$invalidate) {
    	let regexp;
    	let matches;
    	let firstFragment;
    	let lastFragment;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { content = '' } = $$props;
    	let { highlight = '' } = $$props;
    	let active = false;
    	let control;

    	function resizeInput() {
    		if (control) $$invalidate(3, control.style.height = `${control.scrollHeight + 2}px`, control);
    	}

    	afterUpdate(() => {
    		if (active) control.focus();
    	});

    	function textarea_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			control = $$value;
    			$$invalidate(3, control);
    		});
    	}

    	function textarea_input_handler() {
    		content = this.value;
    		$$invalidate(0, content);
    	}

    	const blur_handler = () => $$invalidate(2, active = false);
    	const click_handler = () => $$invalidate(2, active = true);

    	$$self.$$set = $$props => {
    		if ('content' in $$props) $$invalidate(0, content = $$props.content);
    		if ('highlight' in $$props) $$invalidate(7, highlight = $$props.highlight);
    		if ('$$scope' in $$props) $$invalidate(9, $$scope = $$props.$$scope);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*highlight*/ 128) {
    			$$invalidate(8, regexp = new RegExp(highlight, 'gi'));
    		}

    		if ($$self.$$.dirty & /*content, regexp*/ 257) {
    			$$invalidate(1, matches = [...content.matchAll(regexp)]);
    		}

    		if ($$self.$$.dirty & /*matches, content*/ 3) {
    			$$invalidate(5, firstFragment = matches.length == 0
    			? ''
    			: content.substring(0, matches[0].index));
    		}

    		if ($$self.$$.dirty & /*matches, content*/ 3) {
    			$$invalidate(4, lastFragment = matches.length == 0
    			? ''
    			: content.substring(matches[matches.length - 1].index + matches[matches.length - 1][0].length));
    		}
    	};

    	return [
    		content,
    		matches,
    		active,
    		control,
    		lastFragment,
    		firstFragment,
    		resizeInput,
    		highlight,
    		regexp,
    		$$scope,
    		slots,
    		textarea_binding,
    		textarea_input_handler,
    		blur_handler,
    		click_handler
    	];
    }

    class TextArea extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$f, create_fragment$f, safe_not_equal, { content: 0, highlight: 7 });
    	}
    }

    /* src\components\TextInput.svelte generated by Svelte v3.59.2 */

    function create_else_block$3(ctx) {
    	let div;
    	let span;
    	let t0;
    	let button;
    	let t1;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*#slots*/ ctx[4].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);

    	return {
    		c() {
    			div = element("div");
    			span = element("span");
    			if (default_slot) default_slot.c();
    			t0 = space();
    			button = element("button");
    			t1 = text(/*content*/ ctx[0]);
    			attr(span, "class", "align-self-center text-right border-right pr-1 py-2 font-weight-bold");
    			set_style(span, "width", "5.5em");
    			attr(button, "class", "flex-grow-1 btn btn-light text-left");
    			attr(div, "class", "d-flex mb-1 border-bottom");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, span);

    			if (default_slot) {
    				default_slot.m(span, null);
    			}

    			append(div, t0);
    			append(div, button);
    			append(button, t1);
    			current = true;

    			if (!mounted) {
    				dispose = listen(button, "click", /*click_handler*/ ctx[8]);
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 8)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[3],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[3])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null),
    						null
    					);
    				}
    			}

    			if (!current || dirty & /*content*/ 1) set_data(t1, /*content*/ ctx[0]);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (default_slot) default_slot.d(detaching);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (14:0) {#if active}
    function create_if_block$5(ctx) {
    	let div;
    	let span;
    	let t;
    	let input;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*#slots*/ ctx[4].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);

    	return {
    		c() {
    			div = element("div");
    			span = element("span");
    			if (default_slot) default_slot.c();
    			t = space();
    			input = element("input");
    			attr(span, "class", "align-self-center text-right mr-1 py-2 font-weight-bold");
    			set_style(span, "width", "5.5em");
    			set_style(span, "height", "2.5em");
    			attr(input, "class", "flex-grow-1 form-control");
    			attr(div, "class", "d-flex mb-1 border-bottom");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, span);

    			if (default_slot) {
    				default_slot.m(span, null);
    			}

    			append(div, t);
    			append(div, input);
    			/*input_binding*/ ctx[5](input);
    			set_input_value(input, /*content*/ ctx[0]);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(input, "input", /*input_input_handler*/ ctx[6]),
    					listen(input, "blur", /*blur_handler*/ ctx[7])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 8)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[3],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[3])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null),
    						null
    					);
    				}
    			}

    			if (dirty & /*content*/ 1 && input.value !== /*content*/ ctx[0]) {
    				set_input_value(input, /*content*/ ctx[0]);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (default_slot) default_slot.d(detaching);
    			/*input_binding*/ ctx[5](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment$e(ctx) {
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;
    	const if_block_creators = [create_if_block$5, create_else_block$3];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*active*/ ctx[1]) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_blocks[current_block_type_index].m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(if_block_anchor.parentNode, if_block_anchor);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if_blocks[current_block_type_index].d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance$e($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { content = '' } = $$props;
    	let active = false;
    	let control;

    	afterUpdate(() => {
    		if (active) control.focus();
    	});

    	function input_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			control = $$value;
    			$$invalidate(2, control);
    		});
    	}

    	function input_input_handler() {
    		content = this.value;
    		$$invalidate(0, content);
    	}

    	const blur_handler = () => $$invalidate(1, active = false);
    	const click_handler = () => $$invalidate(1, active = true);

    	$$self.$$set = $$props => {
    		if ('content' in $$props) $$invalidate(0, content = $$props.content);
    		if ('$$scope' in $$props) $$invalidate(3, $$scope = $$props.$$scope);
    	};

    	return [
    		content,
    		active,
    		control,
    		$$scope,
    		slots,
    		input_binding,
    		input_input_handler,
    		blur_handler,
    		click_handler
    	];
    }

    class TextInput extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$e, create_fragment$e, safe_not_equal, { content: 0 });
    	}
    }

    /* src\components\Bio.svelte generated by Svelte v3.59.2 */

    function create_default_slot_3$2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Name");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (10:0) <TextInput bind:content={model.experience}>
    function create_default_slot_2$2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Experience");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (11:0) <TextInput bind:content={model.level}>
    function create_default_slot_1$2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Level");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (13:0) <TextArea bind:content={model.info}>
    function create_default_slot$3(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Info");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment$d(ctx) {
    	let textinput0;
    	let updating_content;
    	let t0;
    	let textinput1;
    	let updating_content_1;
    	let t1;
    	let textinput2;
    	let updating_content_2;
    	let t2;
    	let hr;
    	let t3;
    	let textarea;
    	let updating_content_3;
    	let current;

    	function textinput0_content_binding(value) {
    		/*textinput0_content_binding*/ ctx[1](value);
    	}

    	let textinput0_props = {
    		$$slots: { default: [create_default_slot_3$2] },
    		$$scope: { ctx }
    	};

    	if (/*model*/ ctx[0].name !== void 0) {
    		textinput0_props.content = /*model*/ ctx[0].name;
    	}

    	textinput0 = new TextInput({ props: textinput0_props });
    	binding_callbacks.push(() => bind(textinput0, 'content', textinput0_content_binding));

    	function textinput1_content_binding(value) {
    		/*textinput1_content_binding*/ ctx[2](value);
    	}

    	let textinput1_props = {
    		$$slots: { default: [create_default_slot_2$2] },
    		$$scope: { ctx }
    	};

    	if (/*model*/ ctx[0].experience !== void 0) {
    		textinput1_props.content = /*model*/ ctx[0].experience;
    	}

    	textinput1 = new TextInput({ props: textinput1_props });
    	binding_callbacks.push(() => bind(textinput1, 'content', textinput1_content_binding));

    	function textinput2_content_binding(value) {
    		/*textinput2_content_binding*/ ctx[3](value);
    	}

    	let textinput2_props = {
    		$$slots: { default: [create_default_slot_1$2] },
    		$$scope: { ctx }
    	};

    	if (/*model*/ ctx[0].level !== void 0) {
    		textinput2_props.content = /*model*/ ctx[0].level;
    	}

    	textinput2 = new TextInput({ props: textinput2_props });
    	binding_callbacks.push(() => bind(textinput2, 'content', textinput2_content_binding));

    	function textarea_content_binding(value) {
    		/*textarea_content_binding*/ ctx[4](value);
    	}

    	let textarea_props = {
    		$$slots: { default: [create_default_slot$3] },
    		$$scope: { ctx }
    	};

    	if (/*model*/ ctx[0].info !== void 0) {
    		textarea_props.content = /*model*/ ctx[0].info;
    	}

    	textarea = new TextArea({ props: textarea_props });
    	binding_callbacks.push(() => bind(textarea, 'content', textarea_content_binding));

    	return {
    		c() {
    			create_component(textinput0.$$.fragment);
    			t0 = space();
    			create_component(textinput1.$$.fragment);
    			t1 = space();
    			create_component(textinput2.$$.fragment);
    			t2 = space();
    			hr = element("hr");
    			t3 = space();
    			create_component(textarea.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(textinput0, target, anchor);
    			insert(target, t0, anchor);
    			mount_component(textinput1, target, anchor);
    			insert(target, t1, anchor);
    			mount_component(textinput2, target, anchor);
    			insert(target, t2, anchor);
    			insert(target, hr, anchor);
    			insert(target, t3, anchor);
    			mount_component(textarea, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const textinput0_changes = {};

    			if (dirty & /*$$scope*/ 32) {
    				textinput0_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_content && dirty & /*model*/ 1) {
    				updating_content = true;
    				textinput0_changes.content = /*model*/ ctx[0].name;
    				add_flush_callback(() => updating_content = false);
    			}

    			textinput0.$set(textinput0_changes);
    			const textinput1_changes = {};

    			if (dirty & /*$$scope*/ 32) {
    				textinput1_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_content_1 && dirty & /*model*/ 1) {
    				updating_content_1 = true;
    				textinput1_changes.content = /*model*/ ctx[0].experience;
    				add_flush_callback(() => updating_content_1 = false);
    			}

    			textinput1.$set(textinput1_changes);
    			const textinput2_changes = {};

    			if (dirty & /*$$scope*/ 32) {
    				textinput2_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_content_2 && dirty & /*model*/ 1) {
    				updating_content_2 = true;
    				textinput2_changes.content = /*model*/ ctx[0].level;
    				add_flush_callback(() => updating_content_2 = false);
    			}

    			textinput2.$set(textinput2_changes);
    			const textarea_changes = {};

    			if (dirty & /*$$scope*/ 32) {
    				textarea_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_content_3 && dirty & /*model*/ 1) {
    				updating_content_3 = true;
    				textarea_changes.content = /*model*/ ctx[0].info;
    				add_flush_callback(() => updating_content_3 = false);
    			}

    			textarea.$set(textarea_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(textinput0.$$.fragment, local);
    			transition_in(textinput1.$$.fragment, local);
    			transition_in(textinput2.$$.fragment, local);
    			transition_in(textarea.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(textinput0.$$.fragment, local);
    			transition_out(textinput1.$$.fragment, local);
    			transition_out(textinput2.$$.fragment, local);
    			transition_out(textarea.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(textinput0, detaching);
    			if (detaching) detach(t0);
    			destroy_component(textinput1, detaching);
    			if (detaching) detach(t1);
    			destroy_component(textinput2, detaching);
    			if (detaching) detach(t2);
    			if (detaching) detach(hr);
    			if (detaching) detach(t3);
    			destroy_component(textarea, detaching);
    		}
    	};
    }

    function instance$d($$self, $$props, $$invalidate) {
    	let { model } = $$props;

    	function textinput0_content_binding(value) {
    		if ($$self.$$.not_equal(model.name, value)) {
    			model.name = value;
    			$$invalidate(0, model);
    		}
    	}

    	function textinput1_content_binding(value) {
    		if ($$self.$$.not_equal(model.experience, value)) {
    			model.experience = value;
    			$$invalidate(0, model);
    		}
    	}

    	function textinput2_content_binding(value) {
    		if ($$self.$$.not_equal(model.level, value)) {
    			model.level = value;
    			$$invalidate(0, model);
    		}
    	}

    	function textarea_content_binding(value) {
    		if ($$self.$$.not_equal(model.info, value)) {
    			model.info = value;
    			$$invalidate(0, model);
    		}
    	}

    	$$self.$$set = $$props => {
    		if ('model' in $$props) $$invalidate(0, model = $$props.model);
    	};

    	return [
    		model,
    		textinput0_content_binding,
    		textinput1_content_binding,
    		textinput2_content_binding,
    		textarea_content_binding
    	];
    }

    class Bio extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$d, create_fragment$d, safe_not_equal, { model: 0 });
    	}
    }

    /* src\components\Details.svelte generated by Svelte v3.59.2 */

    function create_if_block$4(ctx) {
    	let div2;
    	let div1;
    	let div0;
    	let current;
    	const default_slot_template = /*#slots*/ ctx[3].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[2], null);

    	return {
    		c() {
    			div2 = element("div");
    			div1 = element("div");
    			div0 = element("div");
    			if (default_slot) default_slot.c();
    			attr(div0, "class", "card-body");
    			attr(div1, "class", "card");
    			attr(div2, "class", "container-fluid m-0 p-0");
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    			append(div2, div1);
    			append(div1, div0);

    			if (default_slot) {
    				default_slot.m(div0, null);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 4)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[2],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[2])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[2], dirty, null),
    						null
    					);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div2);
    			if (default_slot) default_slot.d(detaching);
    		}
    	};
    }

    function create_fragment$c(ctx) {
    	let div;
    	let button;
    	let t0;
    	let t1;
    	let current;
    	let mounted;
    	let dispose;
    	let if_block = /*open*/ ctx[0] && create_if_block$4(ctx);

    	return {
    		c() {
    			div = element("div");
    			button = element("button");
    			t0 = text(/*title*/ ctx[1]);
    			t1 = space();
    			if (if_block) if_block.c();
    			attr(button, "class", "btn btn-light border w-100 text-left align-top");
    			attr(div, "class", "col-12 p-1");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, button);
    			append(button, t0);
    			append(div, t1);
    			if (if_block) if_block.m(div, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen(button, "click", /*click_handler*/ ctx[4]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (!current || dirty & /*title*/ 2) set_data(t0, /*title*/ ctx[1]);

    			if (/*open*/ ctx[0]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty & /*open*/ 1) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block$4(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(div, null);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block) if_block.d();
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance$c($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { title } = $$props;
    	let { open = false } = $$props;
    	const click_handler = () => $$invalidate(0, open = !open);

    	$$self.$$set = $$props => {
    		if ('title' in $$props) $$invalidate(1, title = $$props.title);
    		if ('open' in $$props) $$invalidate(0, open = $$props.open);
    		if ('$$scope' in $$props) $$invalidate(2, $$scope = $$props.$$scope);
    	};

    	return [open, title, $$scope, slots, click_handler];
    }

    class Details extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$c, create_fragment$c, safe_not_equal, { title: 1, open: 0 });
    	}
    }

    /* src\components\Item.svelte generated by Svelte v3.59.2 */

    function create_else_block$2(ctx) {
    	let button0;
    	let t0_value = /*item*/ ctx[0].name + "";
    	let t0;
    	let button0_class_value;
    	let t1;
    	let button1;
    	let t2_value = /*item*/ ctx[0].size + "";
    	let t2;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			button0 = element("button");
    			t0 = text(t0_value);
    			t1 = space();
    			button1 = element("button");
    			t2 = text(t2_value);
    			attr(button0, "title", "name");
    			attr(button0, "class", button0_class_value = "btn " + /*btnStyle*/ ctx[2] + " border text-left flex-grow-1");
    			attr(button1, "title", "size");
    			attr(button1, "class", "btn btn-dark border ml-1");
    		},
    		m(target, anchor) {
    			insert(target, button0, anchor);
    			append(button0, t0);
    			insert(target, t1, anchor);
    			insert(target, button1, anchor);
    			append(button1, t2);

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*click_handler_1*/ ctx[6]),
    					listen(button1, "click", /*click_handler_2*/ ctx[7])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*item*/ 1 && t0_value !== (t0_value = /*item*/ ctx[0].name + "")) set_data(t0, t0_value);

    			if (dirty & /*btnStyle*/ 4 && button0_class_value !== (button0_class_value = "btn " + /*btnStyle*/ ctx[2] + " border text-left flex-grow-1")) {
    				attr(button0, "class", button0_class_value);
    			}

    			if (dirty & /*item*/ 1 && t2_value !== (t2_value = /*item*/ ctx[0].size + "")) set_data(t2, t2_value);
    		},
    		d(detaching) {
    			if (detaching) detach(button0);
    			if (detaching) detach(t1);
    			if (detaching) detach(button1);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (7:0) {#if isEditing}
    function create_if_block$3(ctx) {
    	let input0;
    	let t0;
    	let div;
    	let input1;
    	let t1;
    	let button;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			input0 = element("input");
    			t0 = space();
    			div = element("div");
    			input1 = element("input");
    			t1 = space();
    			button = element("button");
    			button.textContent = "Close";
    			attr(input0, "class", "form-control flex-grow-1");
    			attr(input1, "class", "form-control ml-1");
    			attr(input1, "type", "number");
    			attr(input1, "min", "0");
    			attr(button, "class", "btn btn-light border-dark ml-1");
    		},
    		m(target, anchor) {
    			insert(target, input0, anchor);
    			set_input_value(input0, /*item*/ ctx[0].name);
    			insert(target, t0, anchor);
    			insert(target, div, anchor);
    			append(div, input1);
    			set_input_value(input1, /*item*/ ctx[0].size);
    			insert(target, t1, anchor);
    			insert(target, button, anchor);

    			if (!mounted) {
    				dispose = [
    					listen(input0, "input", /*input0_input_handler*/ ctx[3]),
    					listen(input1, "input", /*input1_input_handler*/ ctx[4]),
    					listen(button, "click", /*click_handler*/ ctx[5])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*item*/ 1 && input0.value !== /*item*/ ctx[0].name) {
    				set_input_value(input0, /*item*/ ctx[0].name);
    			}

    			if (dirty & /*item*/ 1 && to_number(input1.value) !== /*item*/ ctx[0].size) {
    				set_input_value(input1, /*item*/ ctx[0].size);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(input0);
    			if (detaching) detach(t0);
    			if (detaching) detach(div);
    			if (detaching) detach(t1);
    			if (detaching) detach(button);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment$b(ctx) {
    	let if_block_anchor;

    	function select_block_type(ctx, dirty) {
    		if (/*isEditing*/ ctx[1]) return create_if_block$3;
    		return create_else_block$2;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type(ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, [dirty]) {
    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance$b($$self, $$props, $$invalidate) {
    	let { item } = $$props;
    	let { isEditing } = $$props;
    	let { btnStyle = 'btn-light' } = $$props;

    	function input0_input_handler() {
    		item.name = this.value;
    		$$invalidate(0, item);
    	}

    	function input1_input_handler() {
    		item.size = to_number(this.value);
    		$$invalidate(0, item);
    	}

    	const click_handler = () => {
    		$$invalidate(1, isEditing = false);
    	};

    	const click_handler_1 = () => $$invalidate(1, isEditing = true);
    	const click_handler_2 = () => $$invalidate(1, isEditing = true);

    	$$self.$$set = $$props => {
    		if ('item' in $$props) $$invalidate(0, item = $$props.item);
    		if ('isEditing' in $$props) $$invalidate(1, isEditing = $$props.isEditing);
    		if ('btnStyle' in $$props) $$invalidate(2, btnStyle = $$props.btnStyle);
    	};

    	return [
    		item,
    		isEditing,
    		btnStyle,
    		input0_input_handler,
    		input1_input_handler,
    		click_handler,
    		click_handler_1,
    		click_handler_2
    	];
    }

    class Item extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$b, create_fragment$b, safe_not_equal, { item: 0, isEditing: 1, btnStyle: 2 });
    	}
    }

    /* src\components\ListItem.svelte generated by Svelte v3.59.2 */

    function create_fragment$a(ctx) {
    	let div3;
    	let div0;
    	let t0;
    	let div2;
    	let div1;
    	let button0;
    	let t2;
    	let button1;
    	let t4;
    	let button2;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*#slots*/ ctx[4].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);

    	return {
    		c() {
    			div3 = element("div");
    			div0 = element("div");
    			if (default_slot) default_slot.c();
    			t0 = space();
    			div2 = element("div");
    			div1 = element("div");
    			button0 = element("button");
    			button0.textContent = "↑";
    			t2 = space();
    			button1 = element("button");
    			button1.textContent = "↓";
    			t4 = space();
    			button2 = element("button");
    			button2.textContent = "Delete";
    			attr(div0, "class", "flex-grow-1 d-flex mr-1");
    			attr(button0, "class", "btn btn-light border-dark");
    			attr(button1, "class", "btn btn-light border-dark");
    			attr(div1, "class", "btn-group");
    			attr(button2, "class", "btn btn-danger");
    			attr(div2, "class", "align-self-start ml-auto");
    			attr(div3, "class", "d-flex m-1 align-self-start");
    		},
    		m(target, anchor) {
    			insert(target, div3, anchor);
    			append(div3, div0);

    			if (default_slot) {
    				default_slot.m(div0, null);
    			}

    			append(div3, t0);
    			append(div3, div2);
    			append(div2, div1);
    			append(div1, button0);
    			append(div1, t2);
    			append(div1, button1);
    			append(div2, t4);
    			append(div2, button2);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*click_handler*/ ctx[5]),
    					listen(button1, "click", /*click_handler_1*/ ctx[6]),
    					listen(button2, "click", /*click_handler_2*/ ctx[7])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 8)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[3],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[3])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null),
    						null
    					);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div3);
    			if (default_slot) default_slot.d(detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$a($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { move } = $$props;
    	let { remove } = $$props;
    	let { item } = $$props;
    	const click_handler = () => move(-1, item);
    	const click_handler_1 = () => move(1, item);
    	const click_handler_2 = () => remove(item);

    	$$self.$$set = $$props => {
    		if ('move' in $$props) $$invalidate(0, move = $$props.move);
    		if ('remove' in $$props) $$invalidate(1, remove = $$props.remove);
    		if ('item' in $$props) $$invalidate(2, item = $$props.item);
    		if ('$$scope' in $$props) $$invalidate(3, $$scope = $$props.$$scope);
    	};

    	return [
    		move,
    		remove,
    		item,
    		$$scope,
    		slots,
    		click_handler,
    		click_handler_1,
    		click_handler_2
    	];
    }

    class ListItem extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$a, create_fragment$a, safe_not_equal, { move: 0, remove: 1, item: 2 });
    	}
    }

    var listActions = {
        move: (collection, n, item) => {
            let index = collection.indexOf(item);
            collection.splice(index, 1);

            index += n;
            if (index < 0) index = collection.length;
            else if (index > collection.length) index = 0;

            collection.splice(index, 0, item);
            collection = collection;
        },
        remove: (collection, item) => {
            let index = collection.indexOf(item);
            collection.splice(index, 1);
            collection = collection;
        }
    };

    /* src\components\Collection.svelte generated by Svelte v3.59.2 */

    function get_each_context$2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[10] = list[i];
    	child_ctx[11] = list;
    	child_ctx[12] = i;
    	return child_ctx;
    }

    // (42:4) <ListItem item={item} move={move} remove={remove}>
    function create_default_slot$2(ctx) {
    	let item;
    	let updating_item;
    	let t;
    	let current;

    	function item_item_binding(value) {
    		/*item_item_binding*/ ctx[9](value, /*item*/ ctx[10], /*each_value*/ ctx[11], /*item_index*/ ctx[12]);
    	}

    	let item_props = {};

    	if (/*item*/ ctx[10] !== void 0) {
    		item_props.item = /*item*/ ctx[10];
    	}

    	item = new Item({ props: item_props });
    	binding_callbacks.push(() => bind(item, 'item', item_item_binding));

    	return {
    		c() {
    			create_component(item.$$.fragment);
    			t = space();
    		},
    		m(target, anchor) {
    			mount_component(item, target, anchor);
    			insert(target, t, anchor);
    			current = true;
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			const item_changes = {};

    			if (!updating_item && dirty & /*model*/ 1) {
    				updating_item = true;
    				item_changes.item = /*item*/ ctx[10];
    				add_flush_callback(() => updating_item = false);
    			}

    			item.$set(item_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(item.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(item.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(item, detaching);
    			if (detaching) detach(t);
    		}
    	};
    }

    // (41:0) {#each model as item}
    function create_each_block$2(ctx) {
    	let listitem;
    	let current;

    	listitem = new ListItem({
    			props: {
    				item: /*item*/ ctx[10],
    				move: /*move*/ ctx[6],
    				remove: /*remove*/ ctx[7],
    				$$slots: { default: [create_default_slot$2] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			create_component(listitem.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(listitem, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const listitem_changes = {};
    			if (dirty & /*model*/ 1) listitem_changes.item = /*item*/ ctx[10];

    			if (dirty & /*$$scope, model*/ 8193) {
    				listitem_changes.$$scope = { dirty, ctx };
    			}

    			listitem.$set(listitem_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(listitem.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(listitem.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(listitem, detaching);
    		}
    	};
    }

    function create_fragment$9(ctx) {
    	let div;
    	let span0;
    	let t0;
    	let t1;
    	let span1;
    	let t2;
    	let t3;
    	let t4;
    	let span1_class_value;
    	let t5;
    	let button;
    	let t7;
    	let each_1_anchor;
    	let current;
    	let mounted;
    	let dispose;
    	let each_value = /*model*/ ctx[0];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$2(get_each_context$2(ctx, each_value, i));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	return {
    		c() {
    			div = element("div");
    			span0 = element("span");
    			t0 = text(/*title*/ ctx[2]);
    			t1 = space();
    			span1 = element("span");
    			t2 = text(/*totalSize*/ ctx[4]);
    			t3 = text("/");
    			t4 = text(/*capacity*/ ctx[1]);
    			t5 = space();
    			button = element("button");
    			button.textContent = "Add";
    			t7 = space();

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			each_1_anchor = empty();
    			attr(span1, "title", "capacity");
    			attr(span1, "class", span1_class_value = "ml-auto btn " + /*btnStyle*/ ctx[3]);
    			attr(button, "class", "ml-1 btn btn-dark");
    			attr(div, "class", "d-flex align-items-end m-1");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, span0);
    			append(span0, t0);
    			append(div, t1);
    			append(div, span1);
    			append(span1, t2);
    			append(span1, t3);
    			append(span1, t4);
    			append(div, t5);
    			append(div, button);
    			insert(target, t7, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				if (each_blocks[i]) {
    					each_blocks[i].m(target, anchor);
    				}
    			}

    			insert(target, each_1_anchor, anchor);
    			current = true;

    			if (!mounted) {
    				dispose = listen(button, "click", /*add*/ ctx[5]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (!current || dirty & /*title*/ 4) set_data(t0, /*title*/ ctx[2]);
    			if (!current || dirty & /*totalSize*/ 16) set_data(t2, /*totalSize*/ ctx[4]);
    			if (!current || dirty & /*capacity*/ 2) set_data(t4, /*capacity*/ ctx[1]);

    			if (!current || dirty & /*btnStyle*/ 8 && span1_class_value !== (span1_class_value = "ml-auto btn " + /*btnStyle*/ ctx[3])) {
    				attr(span1, "class", span1_class_value);
    			}

    			if (dirty & /*model, move, remove*/ 193) {
    				each_value = /*model*/ ctx[0];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$2(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block$2(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
    					}
    				}

    				group_outros();

    				for (i = each_value.length; i < each_blocks.length; i += 1) {
    					out(i);
    				}

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			current = true;
    		},
    		o(local) {
    			each_blocks = each_blocks.filter(Boolean);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (detaching) detach(t7);
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(each_1_anchor);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance$9($$self, $$props, $$invalidate) {
    	let totalSize;
    	let { model } = $$props;
    	let { capacity } = $$props;
    	let { title } = $$props;
    	let { btnStyle } = $$props;
    	let { update } = $$props;

    	function add() {
    		model.push({ name: '', size: 1 });
    		$$invalidate(0, model);
    		if (update) update();
    	}

    	function move(n, item) {
    		listActions.move(model, n, item);
    		$$invalidate(0, model);
    		if (update) update();
    	}

    	function remove(item) {
    		listActions.remove(model, item);
    		$$invalidate(0, model);
    		if (update) update();
    	}

    	function item_item_binding(value, item, each_value, item_index) {
    		each_value[item_index] = value;
    		$$invalidate(0, model);
    	}

    	$$self.$$set = $$props => {
    		if ('model' in $$props) $$invalidate(0, model = $$props.model);
    		if ('capacity' in $$props) $$invalidate(1, capacity = $$props.capacity);
    		if ('title' in $$props) $$invalidate(2, title = $$props.title);
    		if ('btnStyle' in $$props) $$invalidate(3, btnStyle = $$props.btnStyle);
    		if ('update' in $$props) $$invalidate(8, update = $$props.update);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*model*/ 1) {
    			$$invalidate(4, totalSize = model.reduce((a, b) => a + b.size, 0));
    		}
    	};

    	return [
    		model,
    		capacity,
    		title,
    		btnStyle,
    		totalSize,
    		add,
    		move,
    		remove,
    		update,
    		item_item_binding
    	];
    }

    class Collection extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$9, create_fragment$9, safe_not_equal, {
    			model: 0,
    			capacity: 1,
    			title: 2,
    			btnStyle: 3,
    			update: 8
    		});
    	}
    }

    /* src\components\Equipment.svelte generated by Svelte v3.59.2 */

    function create_fragment$8(ctx) {
    	let collection0;
    	let t0;
    	let hr;
    	let t1;
    	let collection1;
    	let current;

    	collection0 = new Collection({
    			props: {
    				model: /*model*/ ctx[0].equipment,
    				capacity: /*maxItemSize*/ ctx[2],
    				btnStyle: /*itemBtnStyle*/ ctx[4],
    				update: /*update*/ ctx[5],
    				title: "Equipment"
    			}
    		});

    	collection1 = new Collection({
    			props: {
    				model: /*model*/ ctx[0].wounds,
    				capacity: /*maxWoundSize*/ ctx[1],
    				btnStyle: /*woundBtnStyle*/ ctx[3],
    				update: /*update*/ ctx[5],
    				title: "Wounds"
    			}
    		});

    	return {
    		c() {
    			create_component(collection0.$$.fragment);
    			t0 = space();
    			hr = element("hr");
    			t1 = space();
    			create_component(collection1.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(collection0, target, anchor);
    			insert(target, t0, anchor);
    			insert(target, hr, anchor);
    			insert(target, t1, anchor);
    			mount_component(collection1, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const collection0_changes = {};
    			if (dirty & /*model*/ 1) collection0_changes.model = /*model*/ ctx[0].equipment;
    			if (dirty & /*maxItemSize*/ 4) collection0_changes.capacity = /*maxItemSize*/ ctx[2];
    			if (dirty & /*itemBtnStyle*/ 16) collection0_changes.btnStyle = /*itemBtnStyle*/ ctx[4];
    			collection0.$set(collection0_changes);
    			const collection1_changes = {};
    			if (dirty & /*model*/ 1) collection1_changes.model = /*model*/ ctx[0].wounds;
    			if (dirty & /*maxWoundSize*/ 2) collection1_changes.capacity = /*maxWoundSize*/ ctx[1];
    			if (dirty & /*woundBtnStyle*/ 8) collection1_changes.btnStyle = /*woundBtnStyle*/ ctx[3];
    			collection1.$set(collection1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(collection0.$$.fragment, local);
    			transition_in(collection1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(collection0.$$.fragment, local);
    			transition_out(collection1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(collection0, detaching);
    			if (detaching) detach(t0);
    			if (detaching) detach(hr);
    			if (detaching) detach(t1);
    			destroy_component(collection1, detaching);
    		}
    	};
    }

    function instance$8($$self, $$props, $$invalidate) {
    	let totalItemSize;
    	let totalWoundSize;
    	let maxWoundSize;
    	let maxItemSize;
    	let itemBtnStyle;
    	let woundBtnStyle;
    	let { model } = $$props;

    	function update() {
    		$$invalidate(0, model);
    		$$invalidate(0, model);
    	}

    	$$self.$$set = $$props => {
    		if ('model' in $$props) $$invalidate(0, model = $$props.model);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*model*/ 1) {
    			$$invalidate(7, totalItemSize = model.equipment.reduce((a, b) => a + b.size, 0));
    		}

    		if ($$self.$$.dirty & /*model*/ 1) {
    			$$invalidate(6, totalWoundSize = model.wounds.reduce((a, b) => a + b.size, 0));
    		}

    		if ($$self.$$.dirty & /*model*/ 1) {
    			$$invalidate(1, maxWoundSize = 10 + model.abilities.constitution);
    		}

    		if ($$self.$$.dirty & /*model, totalWoundSize*/ 65) {
    			$$invalidate(2, maxItemSize = 10 + model.abilities.constitution - totalWoundSize);
    		}

    		if ($$self.$$.dirty & /*totalItemSize, maxItemSize, totalWoundSize*/ 196) {
    			$$invalidate(4, itemBtnStyle = totalItemSize > maxItemSize
    			? 'btn-danger'
    			: totalWoundSize > 0 ? 'btn-warning' : 'btn-dark');
    		}

    		if ($$self.$$.dirty & /*totalWoundSize, maxWoundSize*/ 66) {
    			$$invalidate(3, woundBtnStyle = totalWoundSize >= maxWoundSize
    			? 'btn-danger'
    			: totalWoundSize > 0 ? 'btn-warning' : 'btn-dark');
    		}
    	};

    	return [
    		model,
    		maxWoundSize,
    		maxItemSize,
    		woundBtnStyle,
    		itemBtnStyle,
    		update,
    		totalWoundSize,
    		totalItemSize
    	];
    }

    class Equipment extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$8, create_fragment$8, safe_not_equal, { model: 0 });
    	}
    }

    const patch = (a, b) => {
        for(let key in b) {
            if(!a[key]) a[key] = b[key];
            if(typeof(a[key]) == 'object') {
                patch(a[key], b[key]);
            }
        }
    };

    var actions = {
        delete: (model) => {
            if(!confirm(`Delete ${model.name}?`)) return;

            localStorage.removeItem(`${model.name}.knave2e`);
            return { success: `${model.name} deleted from character storage` };
        },
        deleteAll: () => {
            if(!confirm('Delete all saved characters?')) return;
            let characters = [...new Array(window.localStorage.length)].map((x,i) => window.localStorage.key(i));
            characters = characters.filter(c => c.endsWith('.knave2e'));
            characters.forEach(c => localStorage.removeItem(c));
            return { success: 'All characters deleted from character storage' };
        },
        export: (model) => {
            let href = URL.createObjectURL(new Blob([JSON.stringify(model)]));
            let a = document.createElement('a');
            a.href = href;
            a.download = `${model.name}.knave2e`;
            a.click();
        },
        import: (done) => {
            let file = document.createElement('input');
            file.type = 'file';
            file.accept = '.knave2e';
            file.onchange = (e) => {
                e.target.files[0].text().then((t) => {
                    let key = JSON.parse(t).name;
                    localStorage.setItem(key, t);
                    done(`${key} added to character storage`);
                });
            };
            file.click();
        },
        load: (model, key) => {
            let name = key;
            if(name == `${model.name}.knave2e`) return { model };

            let alert = '';
            if(model.name && confirm(`Save ${model.name} before changing characters?`)) {
                localStorage.setItem(model.name, JSON.stringify(model));
                alert += `${model.name} saved, `;
            }

            model = JSON.parse(localStorage.getItem(name));
            
            patch(model, character());
            return { model, alert: { success: `${alert}${model.name} opened` }};
        },
        loadList: () => {
            let characters = [...new Array(window.localStorage.length)].map((x,i) => window.localStorage.key(i));
            characters = characters.filter(c => c.endsWith('.knave2e'));
            characters.sort((a,b) => a.localeCompare(b));
            return characters;
        },
        save: (model) => {
            if(!model.name)
                return { error: 'Cannot save an unnamed character' };

            localStorage.setItem(`${model.name}.knave2e`, JSON.stringify(model));
            return { success: `${model.name} saved` };
        }
    };

    /* src\components\Navbar.svelte generated by Svelte v3.59.2 */

    function get_each_context$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[27] = list[i];
    	return child_ctx;
    }

    // (101:20) {#each characters as character}
    function create_each_block$1(ctx) {
    	let button;
    	let t_value = /*character*/ ctx[27] + "";
    	let t;
    	let mounted;
    	let dispose;

    	function click_handler_1() {
    		return /*click_handler_1*/ ctx[16](/*character*/ ctx[27]);
    	}

    	return {
    		c() {
    			button = element("button");
    			t = text(t_value);
    			attr(button, "class", "dropdown-item");
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);
    			append(button, t);

    			if (!mounted) {
    				dispose = [
    					listen(button, "blur", /*clearMenu*/ ctx[6]),
    					listen(button, "click", click_handler_1)
    				];

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty & /*characters*/ 4 && t_value !== (t_value = /*character*/ ctx[27] + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (126:23) 
    function create_if_block_1$1(ctx) {
    	let button;
    	let strong;
    	let t_value = /*alert*/ ctx[3].error + "";
    	let t;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			button = element("button");
    			strong = element("strong");
    			t = text(t_value);
    			attr(button, "class", "alert alert-static alert-danger btn text-center w-100");
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);
    			append(button, strong);
    			append(strong, t);
    			/*button_binding_1*/ ctx[22](button);

    			if (!mounted) {
    				dispose = [
    					listen(button, "blur", /*blur_handler_1*/ ctx[23]),
    					listen(button, "click", /*click_handler_5*/ ctx[24])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*alert*/ 8 && t_value !== (t_value = /*alert*/ ctx[3].error + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			/*button_binding_1*/ ctx[22](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (122:0) {#if alert?.success}
    function create_if_block$2(ctx) {
    	let button;
    	let strong;
    	let t_value = /*alert*/ ctx[3].success + "";
    	let t;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			button = element("button");
    			strong = element("strong");
    			t = text(t_value);
    			attr(button, "class", "alert alert-static alert-success btn text-center w-100");
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);
    			append(button, strong);
    			append(strong, t);
    			/*button_binding*/ ctx[19](button);

    			if (!mounted) {
    				dispose = [
    					listen(button, "blur", /*blur_handler*/ ctx[20]),
    					listen(button, "click", /*click_handler_4*/ ctx[21])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*alert*/ 8 && t_value !== (t_value = /*alert*/ ctx[3].success + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			/*button_binding*/ ctx[19](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment$7(ctx) {
    	let nav;
    	let button0;
    	let t0;
    	let div4;
    	let ul;
    	let li;
    	let a;
    	let t2;
    	let div0;
    	let div0_style_value;
    	let t3;
    	let div3;
    	let div2;
    	let button1;
    	let t5;
    	let div1;
    	let button2;
    	let t7;
    	let button3;
    	let t9;
    	let button4;
    	let t11;
    	let button5;
    	let t13;
    	let button6;
    	let t15;
    	let button7;
    	let div1_style_value;
    	let t18;
    	let if_block_anchor;
    	let mounted;
    	let dispose;
    	let each_value = /*characters*/ ctx[2];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
    	}

    	function select_block_type(ctx, dirty) {
    		if (/*alert*/ ctx[3]?.success) return create_if_block$2;
    		if (/*alert*/ ctx[3]?.error) return create_if_block_1$1;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type && current_block_type(ctx);

    	return {
    		c() {
    			nav = element("nav");
    			button0 = element("button");
    			button0.innerHTML = `<span class="navbar-toggler-icon"></span>`;
    			t0 = space();
    			div4 = element("div");
    			ul = element("ul");
    			li = element("li");
    			a = element("a");
    			a.textContent = "Characters";
    			t2 = space();
    			div0 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t3 = space();
    			div3 = element("div");
    			div2 = element("div");
    			button1 = element("button");
    			button1.textContent = "Options";
    			t5 = space();
    			div1 = element("div");
    			button2 = element("button");
    			button2.textContent = "Save";
    			t7 = space();
    			button3 = element("button");
    			button3.textContent = "Export";
    			t9 = space();
    			button4 = element("button");
    			button4.textContent = "Import";
    			t11 = space();
    			button5 = element("button");
    			button5.textContent = "Delete";
    			t13 = space();
    			button6 = element("button");
    			button6.textContent = "Delete all";
    			t15 = space();
    			button7 = element("button");
    			button7.textContent = `${theme == 'dark' ? 'Light' : 'Dark'} mode`;
    			t18 = space();
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    			attr(button0, "class", "navbar-toggler");
    			attr(button0, "type", "button");
    			attr(a, "href", "#");
    			attr(a, "class", "nav-link dropdown-toggle");
    			toggle_class(a, "disabled", !/*characters*/ ctx[2].length);
    			attr(div0, "class", "dropdown-menu");
    			attr(div0, "style", div0_style_value = `display: ${/*menu*/ ctx[1] == 'characters' ? 'block' : 'none'}`);
    			attr(li, "class", "nav-item dropdown");
    			attr(ul, "class", "navbar-nav mr-auto");
    			attr(button1, "href", "#");
    			attr(button1, "class", "dropdown-toggle btn btn-light border border-dark");
    			attr(button2, "class", "dropdown-item");
    			attr(button3, "class", "dropdown-item");
    			attr(button4, "class", "dropdown-item");
    			attr(button5, "class", "dropdown-item");
    			attr(button6, "class", "dropdown-item");
    			attr(button7, "class", "dropdown-item");
    			attr(div1, "class", "dropdown-menu");
    			attr(div1, "style", div1_style_value = `display: ${/*menu*/ ctx[1] == 'options' ? 'block' : 'none'}`);
    			attr(div2, "class", "nav-item dropdown");
    			attr(div3, "class", "navbar-nav");
    			attr(div4, "class", "collapse navbar-collapse");
    			set_style(div4, "display", /*navDisplay*/ ctx[0]);
    			attr(nav, "class", "navbar navbar-expand-md navbar-light bg-light");
    		},
    		m(target, anchor) {
    			insert(target, nav, anchor);
    			append(nav, button0);
    			append(nav, t0);
    			append(nav, div4);
    			append(div4, ul);
    			append(ul, li);
    			append(li, a);
    			append(li, t2);
    			append(li, div0);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				if (each_blocks[i]) {
    					each_blocks[i].m(div0, null);
    				}
    			}

    			append(div4, t3);
    			append(div4, div3);
    			append(div3, div2);
    			append(div2, button1);
    			append(div2, t5);
    			append(div2, div1);
    			append(div1, button2);
    			append(div1, t7);
    			append(div1, button3);
    			append(div1, t9);
    			append(div1, button4);
    			append(div1, t11);
    			append(div1, button5);
    			append(div1, t13);
    			append(div1, button6);
    			append(div1, t15);
    			append(div1, button7);
    			insert(target, t18, anchor);
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*toggleNav*/ ctx[12]),
    					listen(a, "blur", /*clearMenu*/ ctx[6]),
    					listen(a, "click", /*click_handler*/ ctx[15]),
    					listen(button1, "blur", /*clearMenu*/ ctx[6]),
    					listen(button1, "click", /*click_handler_2*/ ctx[17]),
    					listen(button2, "click", /*saveClick*/ ctx[10]),
    					listen(button2, "blur", /*clearMenu*/ ctx[6]),
    					listen(button3, "click", /*exportClick*/ ctx[9]),
    					listen(button3, "blur", /*clearMenu*/ ctx[6]),
    					listen(button4, "click", /*importClick*/ ctx[13]),
    					listen(button4, "blur", /*clearMenu*/ ctx[6]),
    					listen(button5, "click", /*deleteClick*/ ctx[7]),
    					listen(button5, "blur", /*clearMenu*/ ctx[6]),
    					listen(button6, "click", /*deleteAllClick*/ ctx[8]),
    					listen(button6, "blur", /*clearMenu*/ ctx[6]),
    					listen(button7, "click", /*click_handler_3*/ ctx[18])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*characters*/ 4) {
    				toggle_class(a, "disabled", !/*characters*/ ctx[2].length);
    			}

    			if (dirty & /*clearMenu, changeCharacter, characters*/ 100) {
    				each_value = /*characters*/ ctx[2];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$1(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div0, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (dirty & /*menu*/ 2 && div0_style_value !== (div0_style_value = `display: ${/*menu*/ ctx[1] == 'characters' ? 'block' : 'none'}`)) {
    				attr(div0, "style", div0_style_value);
    			}

    			if (dirty & /*menu*/ 2 && div1_style_value !== (div1_style_value = `display: ${/*menu*/ ctx[1] == 'options' ? 'block' : 'none'}`)) {
    				attr(div1, "style", div1_style_value);
    			}

    			if (dirty & /*navDisplay*/ 1) {
    				set_style(div4, "display", /*navDisplay*/ ctx[0]);
    			}

    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if (if_block) if_block.d(1);
    				if_block = current_block_type && current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(nav);
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(t18);

    			if (if_block) {
    				if_block.d(detaching);
    			}

    			if (detaching) detach(if_block_anchor);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    const autosaveInterval = 10000; // 10s

    function instance$7($$self, $$props, $$invalidate) {
    	let { model = character() } = $$props;
    	let navDisplay = 'none';
    	let menu = '';
    	let characters = [];
    	let alert;
    	let dismiss;

    	function changeCharacter(character) {
    		let result = actions.load(model, character);
    		$$invalidate(14, model = result.model);
    		$$invalidate(3, alert = result.alert);
    		toggleNav();
    	}

    	function clearMenu(e) {
    		if (e.relatedTarget?.className.includes('dropdown-item')) return;
    		$$invalidate(1, menu = '');
    	}

    	function deleteClick() {
    		$$invalidate(3, alert = actions.delete(model));
    		loadCharacterList();
    		toggleNav();
    	}

    	function deleteAllClick() {
    		$$invalidate(3, alert = actions.deleteAll());
    		loadCharacterList();
    		toggleNav();
    	}

    	function exportClick() {
    		actions.export(model);
    		toggleNav();
    	}

    	function loadCharacterList() {
    		$$invalidate(2, characters = actions.loadList());
    	}

    	function saveClick() {
    		$$invalidate(3, alert = actions.save(model));
    		$$invalidate(2, characters = actions.loadList());
    		toggleNav();
    	}

    	function setMenu(item) {
    		$$invalidate(1, menu = item);
    	}

    	function toggleNav() {
    		$$invalidate(0, navDisplay = navDisplay == 'none' ? 'block' : 'none');
    	}

    	function importClick() {
    		actions.import(msg => {
    			$$invalidate(3, alert = { success: msg });
    			$$invalidate(2, characters = actions.loadList());
    		});

    		toggleNav();
    	}

    	loadCharacterList();

    	let autoSave = window.setInterval(
    		() => {
    			console.log(`Autosave (${model.name})`);
    			let saved = characters.find(x => x == model.name) != null;
    			if (saved) actions.save(model);
    		},
    		autosaveInterval
    	);

    	afterUpdate(() => {
    		if (dismiss) dismiss.focus();
    	});

    	onDestroy(() => {
    		clearInterval(autoSave);
    	});

    	const click_handler = () => setMenu('characters');
    	const click_handler_1 = character => changeCharacter(character);
    	const click_handler_2 = () => setMenu('options');
    	const click_handler_3 = () => setTheme(theme == 'dark' ? 'light' : 'dark');

    	function button_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			dismiss = $$value;
    			$$invalidate(4, dismiss);
    		});
    	}

    	const blur_handler = () => $$invalidate(3, alert = null);
    	const click_handler_4 = () => $$invalidate(3, alert = null);

    	function button_binding_1($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			dismiss = $$value;
    			$$invalidate(4, dismiss);
    		});
    	}

    	const blur_handler_1 = () => $$invalidate(3, alert = null);
    	const click_handler_5 = () => $$invalidate(3, alert = null);

    	$$self.$$set = $$props => {
    		if ('model' in $$props) $$invalidate(14, model = $$props.model);
    	};

    	return [
    		navDisplay,
    		menu,
    		characters,
    		alert,
    		dismiss,
    		changeCharacter,
    		clearMenu,
    		deleteClick,
    		deleteAllClick,
    		exportClick,
    		saveClick,
    		setMenu,
    		toggleNav,
    		importClick,
    		model,
    		click_handler,
    		click_handler_1,
    		click_handler_2,
    		click_handler_3,
    		button_binding,
    		blur_handler,
    		click_handler_4,
    		button_binding_1,
    		blur_handler_1,
    		click_handler_5
    	];
    }

    class Navbar extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$7, create_fragment$7, safe_not_equal, { model: 14 });
    	}
    }

    var dateUtil = {
        shortDate: (dte = new Date()) => {
            let dd = dte.getDate().toString();
            if(dd.length == 1) dd = `0${dd}`;

            let mm = (dte.getMonth() + 1).toString();
            if(mm.length == 1) mm = `0${mm}`;

            let yyyy = dte.getFullYear();
            while(yyyy.length < 4) yyyy = `0${yyyy}`;

            return `${yyyy}-${mm}-${dd}`
        }
    };

    /* src\components\Note.svelte generated by Svelte v3.59.2 */

    function create_else_block$1(ctx) {
    	let div4;
    	let div3;
    	let div2;
    	let div0;
    	let t0;
    	let button0;
    	let t2;
    	let button1;
    	let t4;
    	let div1;
    	let textarea;
    	let updating_content;
    	let current;
    	let mounted;
    	let dispose;

    	function select_block_type_1(ctx, dirty) {
    		if (/*editTitle*/ ctx[3]) return create_if_block_1;
    		return create_else_block_1;
    	}

    	let current_block_type = select_block_type_1(ctx);
    	let if_block = current_block_type(ctx);

    	function textarea_content_binding(value) {
    		/*textarea_content_binding*/ ctx[15](value);
    	}

    	let textarea_props = { highlight: /*highlight*/ ctx[2] };

    	if (/*note*/ ctx[0].content !== void 0) {
    		textarea_props.content = /*note*/ ctx[0].content;
    	}

    	textarea = new TextArea({ props: textarea_props });
    	binding_callbacks.push(() => bind(textarea, 'content', textarea_content_binding));

    	return {
    		c() {
    			div4 = element("div");
    			div3 = element("div");
    			div2 = element("div");
    			div0 = element("div");
    			if_block.c();
    			t0 = space();
    			button0 = element("button");
    			button0.textContent = "hide";
    			t2 = space();
    			button1 = element("button");
    			button1.textContent = "delete";
    			t4 = space();
    			div1 = element("div");
    			create_component(textarea.$$.fragment);
    			attr(button0, "class", "badge btn btn-light border ml-1 p-2");
    			attr(button1, "class", "badge btn btn-light border ml-1 p-2");
    			attr(div0, "class", "d-flex");
    			attr(div1, "class", "d-flex");
    			attr(div2, "class", "card-body");
    			attr(div3, "class", "card");
    			attr(div4, "class", "col-12");
    		},
    		m(target, anchor) {
    			insert(target, div4, anchor);
    			append(div4, div3);
    			append(div3, div2);
    			append(div2, div0);
    			if_block.m(div0, null);
    			append(div0, t0);
    			append(div0, button0);
    			append(div0, t2);
    			append(div0, button1);
    			append(div2, t4);
    			append(div2, div1);
    			mount_component(textarea, div1, null);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*click_handler_3*/ ctx[13]),
    					listen(button1, "click", /*click_handler_4*/ ctx[14])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (current_block_type === (current_block_type = select_block_type_1(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(div0, t0);
    				}
    			}

    			const textarea_changes = {};
    			if (dirty & /*highlight*/ 4) textarea_changes.highlight = /*highlight*/ ctx[2];

    			if (!updating_content && dirty & /*note*/ 1) {
    				updating_content = true;
    				textarea_changes.content = /*note*/ ctx[0].content;
    				add_flush_callback(() => updating_content = false);
    			}

    			textarea.$set(textarea_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(textarea.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(textarea.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div4);
    			if_block.d();
    			destroy_component(textarea);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (20:0) {#if collapse}
    function create_if_block$1(ctx) {
    	let div;
    	let h4;
    	let button0;
    	let t0_value = /*note*/ ctx[0].title + "";
    	let t0;
    	let t1;
    	let button1;
    	let t2_value = dateUtil.shortDate(/*dateValue*/ ctx[5]) + "";
    	let t2;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			div = element("div");
    			h4 = element("h4");
    			button0 = element("button");
    			t0 = text(t0_value);
    			t1 = space();
    			button1 = element("button");
    			t2 = text(t2_value);
    			attr(button0, "class", "badge btn btn-light w-100 text-left");
    			set_style(button0, "min-height", "2.2em");
    			attr(h4, "class", "flex-grow-1 m-0");
    			attr(button1, "class", "badge btn btn-light border ml-1 p-2");
    			attr(div, "class", "col-12 d-flex");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, h4);
    			append(h4, button0);
    			append(button0, t0);
    			append(div, t1);
    			append(div, button1);
    			append(button1, t2);

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*click_handler*/ ctx[7]),
    					listen(button1, "click", /*click_handler_1*/ ctx[8])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*note*/ 1 && t0_value !== (t0_value = /*note*/ ctx[0].title + "")) set_data(t0, t0_value);
    			if (dirty & /*dateValue*/ 32 && t2_value !== (t2_value = dateUtil.shortDate(/*dateValue*/ ctx[5]) + "")) set_data(t2, t2_value);
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (32:16) {:else}
    function create_else_block_1(ctx) {
    	let button;
    	let t_value = /*note*/ ctx[0].title + "";
    	let t;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			button = element("button");
    			t = text(t_value);
    			attr(button, "class", "btn btn-light w-100 text-left font-weight-bold");
    			set_style(button, "min-height", "2.2em");
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);
    			append(button, t);

    			if (!mounted) {
    				dispose = listen(button, "click", /*click_handler_2*/ ctx[12]);
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*note*/ 1 && t_value !== (t_value = /*note*/ ctx[0].title + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (30:16) {#if editTitle}
    function create_if_block_1(ctx) {
    	let input_1;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			input_1 = element("input");
    			attr(input_1, "class", "form-control");
    		},
    		m(target, anchor) {
    			insert(target, input_1, anchor);
    			/*input_1_binding*/ ctx[10](input_1);
    			set_input_value(input_1, /*note*/ ctx[0].title);

    			if (!mounted) {
    				dispose = [
    					listen(input_1, "blur", /*blur_handler*/ ctx[9]),
    					listen(input_1, "input", /*input_1_input_handler*/ ctx[11])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*note*/ 1 && input_1.value !== /*note*/ ctx[0].title) {
    				set_input_value(input_1, /*note*/ ctx[0].title);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(input_1);
    			/*input_1_binding*/ ctx[10](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment$6(ctx) {
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;
    	const if_block_creators = [create_if_block$1, create_else_block$1];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*collapse*/ ctx[6]) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_blocks[current_block_type_index].m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(if_block_anchor.parentNode, if_block_anchor);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if_blocks[current_block_type_index].d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance$6($$self, $$props, $$invalidate) {
    	let collapse;
    	let dateValue;
    	let { actions } = $$props;
    	let { note } = $$props;
    	let { highlight } = $$props;
    	let editTitle = false;
    	let input;

    	afterUpdate(() => {
    		if (input) input.focus();
    	});

    	const click_handler = () => $$invalidate(6, collapse = false);
    	const click_handler_1 = () => $$invalidate(6, collapse = false);
    	const blur_handler = () => $$invalidate(3, editTitle = false);

    	function input_1_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			input = $$value;
    			$$invalidate(4, input);
    		});
    	}

    	function input_1_input_handler() {
    		note.title = this.value;
    		$$invalidate(0, note);
    	}

    	const click_handler_2 = () => $$invalidate(3, editTitle = true);
    	const click_handler_3 = () => $$invalidate(6, collapse = true);
    	const click_handler_4 = () => actions.delete(note);

    	function textarea_content_binding(value) {
    		if ($$self.$$.not_equal(note.content, value)) {
    			note.content = value;
    			$$invalidate(0, note);
    		}
    	}

    	$$self.$$set = $$props => {
    		if ('actions' in $$props) $$invalidate(1, actions = $$props.actions);
    		if ('note' in $$props) $$invalidate(0, note = $$props.note);
    		if ('highlight' in $$props) $$invalidate(2, highlight = $$props.highlight);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*highlight*/ 4) {
    			$$invalidate(6, collapse = highlight == '');
    		}

    		if ($$self.$$.dirty & /*note*/ 1) {
    			$$invalidate(5, dateValue = new Date(note.date));
    		}
    	};

    	return [
    		note,
    		actions,
    		highlight,
    		editTitle,
    		input,
    		dateValue,
    		collapse,
    		click_handler,
    		click_handler_1,
    		blur_handler,
    		input_1_binding,
    		input_1_input_handler,
    		click_handler_2,
    		click_handler_3,
    		click_handler_4,
    		textarea_content_binding
    	];
    }

    class Note extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$6, create_fragment$6, safe_not_equal, { actions: 1, note: 0, highlight: 2 });
    	}
    }

    /* src\components\Notes.svelte generated by Svelte v3.59.2 */

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[14] = list[i];
    	return child_ctx;
    }

    // (71:4) {#each filtered as note (note.id)}
    function create_each_block(key_1, ctx) {
    	let first;
    	let note;
    	let current;

    	note = new Note({
    			props: {
    				note: /*note*/ ctx[14],
    				actions: /*actions*/ ctx[3],
    				highlight: /*filter*/ ctx[0]
    			}
    		});

    	return {
    		key: key_1,
    		first: null,
    		c() {
    			first = empty();
    			create_component(note.$$.fragment);
    			this.first = first;
    		},
    		m(target, anchor) {
    			insert(target, first, anchor);
    			mount_component(note, target, anchor);
    			current = true;
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			const note_changes = {};
    			if (dirty & /*filtered*/ 4) note_changes.note = /*note*/ ctx[14];
    			if (dirty & /*filter*/ 1) note_changes.highlight = /*filter*/ ctx[0];
    			note.$set(note_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(note.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(note.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(first);
    			destroy_component(note, detaching);
    		}
    	};
    }

    function create_fragment$5(ctx) {
    	let div2;
    	let button0;
    	let t1;
    	let div1;
    	let button1;
    	let t3;
    	let div0;
    	let button2;
    	let t5;
    	let button3;
    	let t7;
    	let button4;
    	let t9;
    	let button5;
    	let div0_style_value;
    	let t11;
    	let div3;
    	let input;
    	let t12;
    	let div4;
    	let each_blocks = [];
    	let each_1_lookup = new Map();
    	let current;
    	let mounted;
    	let dispose;
    	let each_value = /*filtered*/ ctx[2];
    	const get_key = ctx => /*note*/ ctx[14].id;

    	for (let i = 0; i < each_value.length; i += 1) {
    		let child_ctx = get_each_context(ctx, each_value, i);
    		let key = get_key(child_ctx);
    		each_1_lookup.set(key, each_blocks[i] = create_each_block(key, child_ctx));
    	}

    	return {
    		c() {
    			div2 = element("div");
    			button0 = element("button");
    			button0.textContent = "Add note";
    			t1 = space();
    			div1 = element("div");
    			button1 = element("button");
    			button1.textContent = "Sort";
    			t3 = space();
    			div0 = element("div");
    			button2 = element("button");
    			button2.textContent = "Newest";
    			t5 = space();
    			button3 = element("button");
    			button3.textContent = "Oldest";
    			t7 = space();
    			button4 = element("button");
    			button4.textContent = "A → Z";
    			t9 = space();
    			button5 = element("button");
    			button5.textContent = "Z → A";
    			t11 = space();
    			div3 = element("div");
    			input = element("input");
    			t12 = space();
    			div4 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr(button0, "class", "btn btn-light border mb-1 mr-1");
    			attr(button1, "class", "dropdown-toggle btn btn-light border mb-1");
    			attr(button2, "class", "dropdown-item");
    			attr(button3, "class", "dropdown-item");
    			attr(button4, "class", "dropdown-item");
    			attr(button5, "class", "dropdown-item");
    			attr(div0, "class", "dropdown-menu");
    			attr(div0, "style", div0_style_value = `display: ${/*menu*/ ctx[1] == 'sort' ? 'block' : 'none'}`);
    			attr(div1, "class", "dropdown");
    			attr(div2, "class", "d-flex");
    			attr(input, "class", "form-control");
    			attr(input, "placeholder", "filter");
    			attr(div3, "class", "d-flex");
    			attr(div4, "class", "row mt-2");
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    			append(div2, button0);
    			append(div2, t1);
    			append(div2, div1);
    			append(div1, button1);
    			append(div1, t3);
    			append(div1, div0);
    			append(div0, button2);
    			append(div0, t5);
    			append(div0, button3);
    			append(div0, t7);
    			append(div0, button4);
    			append(div0, t9);
    			append(div0, button5);
    			insert(target, t11, anchor);
    			insert(target, div3, anchor);
    			append(div3, input);
    			set_input_value(input, /*filter*/ ctx[0]);
    			insert(target, t12, anchor);
    			insert(target, div4, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				if (each_blocks[i]) {
    					each_blocks[i].m(div4, null);
    				}
    			}

    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*add*/ ctx[4]),
    					listen(button1, "blur", /*clearMenu*/ ctx[5]),
    					listen(button1, "click", /*click_handler*/ ctx[8]),
    					listen(button2, "blur", /*clearMenu*/ ctx[5]),
    					listen(button2, "click", /*click_handler_1*/ ctx[9]),
    					listen(button3, "blur", /*clearMenu*/ ctx[5]),
    					listen(button3, "click", /*click_handler_2*/ ctx[10]),
    					listen(button4, "blur", /*clearMenu*/ ctx[5]),
    					listen(button4, "click", /*click_handler_3*/ ctx[11]),
    					listen(button5, "blur", /*clearMenu*/ ctx[5]),
    					listen(button5, "click", /*click_handler_4*/ ctx[12]),
    					listen(input, "input", /*input_input_handler*/ ctx[13])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (!current || dirty & /*menu*/ 2 && div0_style_value !== (div0_style_value = `display: ${/*menu*/ ctx[1] == 'sort' ? 'block' : 'none'}`)) {
    				attr(div0, "style", div0_style_value);
    			}

    			if (dirty & /*filter*/ 1 && input.value !== /*filter*/ ctx[0]) {
    				set_input_value(input, /*filter*/ ctx[0]);
    			}

    			if (dirty & /*filtered, actions, filter*/ 13) {
    				each_value = /*filtered*/ ctx[2];
    				group_outros();
    				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each_1_lookup, div4, outro_and_destroy_block, create_each_block, null, get_each_context);
    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			current = true;
    		},
    		o(local) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div2);
    			if (detaching) detach(t11);
    			if (detaching) detach(div3);
    			if (detaching) detach(t12);
    			if (detaching) detach(div4);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].d();
    			}

    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$5($$self, $$props, $$invalidate) {
    	let filtered;
    	let { notes } = $$props;

    	const actions = {
    		delete: note => {
    			if (!confirm(`Delete ${note.title}?`)) return;
    			let i = notes.indexOf(note);
    			notes.splice(i, 1);
    			$$invalidate(7, notes);
    		}
    	};

    	let filter = '';
    	let menu = '';

    	function add() {
    		notes.splice(0, 0, {
    			id: crypto.randomUUID(),
    			title: 'New note',
    			date: new Date().toISOString(),
    			content: 'Enter your notes here'
    		});

    		$$invalidate(7, notes);
    	}

    	function clearMenu(e) {
    		if (e.relatedTarget?.className.includes('dropdown-item')) return;
    		$$invalidate(1, menu = '');
    	}

    	function sort(method) {
    		if (method == 'alpha') notes.sort((a, b) => a.title.localeCompare(b.title)); else if (method == 'ralpha') notes.sort((a, b) => b.title.localeCompare(a.title)); else if (method == 'oldest') notes.sort((a, b) => a.date > b.date); else if (method == 'newest') notes.sort((a, b) => a.date < b.date);
    		$$invalidate(7, notes);
    	}

    	const click_handler = () => $$invalidate(1, menu = 'sort');
    	const click_handler_1 = () => sort("newest");
    	const click_handler_2 = () => sort("oldest");
    	const click_handler_3 = () => sort("alpha");
    	const click_handler_4 = () => sort("ralpha");

    	function input_input_handler() {
    		filter = this.value;
    		$$invalidate(0, filter);
    	}

    	$$self.$$set = $$props => {
    		if ('notes' in $$props) $$invalidate(7, notes = $$props.notes);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*notes, filter*/ 129) {
    			$$invalidate(2, filtered = notes.filter(x => !filter || x.title.toLowerCase().includes(filter.toLowerCase()) || x.content.toLowerCase().includes(filter.toLowerCase())));
    		}

    		if ($$self.$$.dirty & /*notes*/ 128) {
    			{
    				notes.forEach(note => {
    					if (!note.id) note.id = crypto.randomUUID();
    				});
    			}
    		}
    	};

    	return [
    		filter,
    		menu,
    		filtered,
    		actions,
    		add,
    		clearMenu,
    		sort,
    		notes,
    		click_handler,
    		click_handler_1,
    		click_handler_2,
    		click_handler_3,
    		click_handler_4,
    		input_input_handler
    	];
    }

    class Notes extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$5, create_fragment$5, safe_not_equal, { notes: 7 });
    	}
    }

    /* src\components\Ability.svelte generated by Svelte v3.59.2 */

    function create_fragment$4(ctx) {
    	let div;
    	let h4;
    	let button;
    	let t0;
    	let t1;
    	let span;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*#slots*/ ctx[5].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[4], null);

    	return {
    		c() {
    			div = element("div");
    			h4 = element("h4");
    			button = element("button");
    			t0 = text(/*scoreText*/ ctx[0]);
    			t1 = space();
    			span = element("span");
    			if (default_slot) default_slot.c();
    			attr(button, "class", "btn btn-dark badge");
    			set_style(button, "width", "3.0em");
    			attr(span, "class", "align-self-center ml-1");
    			attr(div, "class", "d-flex");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, h4);
    			append(h4, button);
    			append(button, t0);
    			append(div, t1);
    			append(div, span);

    			if (default_slot) {
    				default_slot.m(span, null);
    			}

    			current = true;

    			if (!mounted) {
    				dispose = listen(button, "click", /*handleClick*/ ctx[1]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (!current || dirty & /*scoreText*/ 1) set_data(t0, /*scoreText*/ ctx[0]);

    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 16)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[4],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[4])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[4], dirty, null),
    						null
    					);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (default_slot) default_slot.d(detaching);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance$4($$self, $$props, $$invalidate) {
    	let scoreText;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { score } = $$props;
    	let { update } = $$props;

    	function handleClick(e) {
    		$$invalidate(2, score += e.shiftKey ? -1 : 1);
    		if (score < 0) $$invalidate(2, score = 10);
    		if (score > 10) $$invalidate(2, score = 0);
    		if (!update) return;
    		update();
    	}

    	$$self.$$set = $$props => {
    		if ('score' in $$props) $$invalidate(2, score = $$props.score);
    		if ('update' in $$props) $$invalidate(3, update = $$props.update);
    		if ('$$scope' in $$props) $$invalidate(4, $$scope = $$props.$$scope);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*score*/ 4) {
    			$$invalidate(0, scoreText = score > 0 ? `+${score}` : `${score}`);
    		}
    	};

    	return [scoreText, handleClick, score, update, $$scope, slots];
    }

    class Ability extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$4, create_fragment$4, safe_not_equal, { score: 2, update: 3 });
    	}
    }

    /* src\components\Abilities.svelte generated by Svelte v3.59.2 */

    function create_default_slot_5(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Strength");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (9:0) <Ability bind:score={model.abilities.dexterity}>
    function create_default_slot_4(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Dexterity");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (10:0) <Ability bind:score={model.abilities.constitution} {update}>
    function create_default_slot_3$1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Constitution");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (11:0) <Ability bind:score={model.abilities.intelligence}>
    function create_default_slot_2$1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Intelligence");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (12:0) <Ability bind:score={model.abilities.wisdom}>
    function create_default_slot_1$1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Wisdom");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (13:0) <Ability bind:score={model.abilities.charisma}>
    function create_default_slot$1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Charisma");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment$3(ctx) {
    	let ability0;
    	let updating_score;
    	let t0;
    	let ability1;
    	let updating_score_1;
    	let t1;
    	let ability2;
    	let updating_score_2;
    	let t2;
    	let ability3;
    	let updating_score_3;
    	let t3;
    	let ability4;
    	let updating_score_4;
    	let t4;
    	let ability5;
    	let updating_score_5;
    	let current;

    	function ability0_score_binding(value) {
    		/*ability0_score_binding*/ ctx[2](value);
    	}

    	let ability0_props = {
    		$$slots: { default: [create_default_slot_5] },
    		$$scope: { ctx }
    	};

    	if (/*model*/ ctx[0].abilities.strength !== void 0) {
    		ability0_props.score = /*model*/ ctx[0].abilities.strength;
    	}

    	ability0 = new Ability({ props: ability0_props });
    	binding_callbacks.push(() => bind(ability0, 'score', ability0_score_binding));

    	function ability1_score_binding(value) {
    		/*ability1_score_binding*/ ctx[3](value);
    	}

    	let ability1_props = {
    		$$slots: { default: [create_default_slot_4] },
    		$$scope: { ctx }
    	};

    	if (/*model*/ ctx[0].abilities.dexterity !== void 0) {
    		ability1_props.score = /*model*/ ctx[0].abilities.dexterity;
    	}

    	ability1 = new Ability({ props: ability1_props });
    	binding_callbacks.push(() => bind(ability1, 'score', ability1_score_binding));

    	function ability2_score_binding(value) {
    		/*ability2_score_binding*/ ctx[4](value);
    	}

    	let ability2_props = {
    		update: /*update*/ ctx[1],
    		$$slots: { default: [create_default_slot_3$1] },
    		$$scope: { ctx }
    	};

    	if (/*model*/ ctx[0].abilities.constitution !== void 0) {
    		ability2_props.score = /*model*/ ctx[0].abilities.constitution;
    	}

    	ability2 = new Ability({ props: ability2_props });
    	binding_callbacks.push(() => bind(ability2, 'score', ability2_score_binding));

    	function ability3_score_binding(value) {
    		/*ability3_score_binding*/ ctx[5](value);
    	}

    	let ability3_props = {
    		$$slots: { default: [create_default_slot_2$1] },
    		$$scope: { ctx }
    	};

    	if (/*model*/ ctx[0].abilities.intelligence !== void 0) {
    		ability3_props.score = /*model*/ ctx[0].abilities.intelligence;
    	}

    	ability3 = new Ability({ props: ability3_props });
    	binding_callbacks.push(() => bind(ability3, 'score', ability3_score_binding));

    	function ability4_score_binding(value) {
    		/*ability4_score_binding*/ ctx[6](value);
    	}

    	let ability4_props = {
    		$$slots: { default: [create_default_slot_1$1] },
    		$$scope: { ctx }
    	};

    	if (/*model*/ ctx[0].abilities.wisdom !== void 0) {
    		ability4_props.score = /*model*/ ctx[0].abilities.wisdom;
    	}

    	ability4 = new Ability({ props: ability4_props });
    	binding_callbacks.push(() => bind(ability4, 'score', ability4_score_binding));

    	function ability5_score_binding(value) {
    		/*ability5_score_binding*/ ctx[7](value);
    	}

    	let ability5_props = {
    		$$slots: { default: [create_default_slot$1] },
    		$$scope: { ctx }
    	};

    	if (/*model*/ ctx[0].abilities.charisma !== void 0) {
    		ability5_props.score = /*model*/ ctx[0].abilities.charisma;
    	}

    	ability5 = new Ability({ props: ability5_props });
    	binding_callbacks.push(() => bind(ability5, 'score', ability5_score_binding));

    	return {
    		c() {
    			create_component(ability0.$$.fragment);
    			t0 = space();
    			create_component(ability1.$$.fragment);
    			t1 = space();
    			create_component(ability2.$$.fragment);
    			t2 = space();
    			create_component(ability3.$$.fragment);
    			t3 = space();
    			create_component(ability4.$$.fragment);
    			t4 = space();
    			create_component(ability5.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(ability0, target, anchor);
    			insert(target, t0, anchor);
    			mount_component(ability1, target, anchor);
    			insert(target, t1, anchor);
    			mount_component(ability2, target, anchor);
    			insert(target, t2, anchor);
    			mount_component(ability3, target, anchor);
    			insert(target, t3, anchor);
    			mount_component(ability4, target, anchor);
    			insert(target, t4, anchor);
    			mount_component(ability5, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const ability0_changes = {};

    			if (dirty & /*$$scope*/ 256) {
    				ability0_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_score && dirty & /*model*/ 1) {
    				updating_score = true;
    				ability0_changes.score = /*model*/ ctx[0].abilities.strength;
    				add_flush_callback(() => updating_score = false);
    			}

    			ability0.$set(ability0_changes);
    			const ability1_changes = {};

    			if (dirty & /*$$scope*/ 256) {
    				ability1_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_score_1 && dirty & /*model*/ 1) {
    				updating_score_1 = true;
    				ability1_changes.score = /*model*/ ctx[0].abilities.dexterity;
    				add_flush_callback(() => updating_score_1 = false);
    			}

    			ability1.$set(ability1_changes);
    			const ability2_changes = {};
    			if (dirty & /*update*/ 2) ability2_changes.update = /*update*/ ctx[1];

    			if (dirty & /*$$scope*/ 256) {
    				ability2_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_score_2 && dirty & /*model*/ 1) {
    				updating_score_2 = true;
    				ability2_changes.score = /*model*/ ctx[0].abilities.constitution;
    				add_flush_callback(() => updating_score_2 = false);
    			}

    			ability2.$set(ability2_changes);
    			const ability3_changes = {};

    			if (dirty & /*$$scope*/ 256) {
    				ability3_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_score_3 && dirty & /*model*/ 1) {
    				updating_score_3 = true;
    				ability3_changes.score = /*model*/ ctx[0].abilities.intelligence;
    				add_flush_callback(() => updating_score_3 = false);
    			}

    			ability3.$set(ability3_changes);
    			const ability4_changes = {};

    			if (dirty & /*$$scope*/ 256) {
    				ability4_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_score_4 && dirty & /*model*/ 1) {
    				updating_score_4 = true;
    				ability4_changes.score = /*model*/ ctx[0].abilities.wisdom;
    				add_flush_callback(() => updating_score_4 = false);
    			}

    			ability4.$set(ability4_changes);
    			const ability5_changes = {};

    			if (dirty & /*$$scope*/ 256) {
    				ability5_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_score_5 && dirty & /*model*/ 1) {
    				updating_score_5 = true;
    				ability5_changes.score = /*model*/ ctx[0].abilities.charisma;
    				add_flush_callback(() => updating_score_5 = false);
    			}

    			ability5.$set(ability5_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(ability0.$$.fragment, local);
    			transition_in(ability1.$$.fragment, local);
    			transition_in(ability2.$$.fragment, local);
    			transition_in(ability3.$$.fragment, local);
    			transition_in(ability4.$$.fragment, local);
    			transition_in(ability5.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(ability0.$$.fragment, local);
    			transition_out(ability1.$$.fragment, local);
    			transition_out(ability2.$$.fragment, local);
    			transition_out(ability3.$$.fragment, local);
    			transition_out(ability4.$$.fragment, local);
    			transition_out(ability5.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(ability0, detaching);
    			if (detaching) detach(t0);
    			destroy_component(ability1, detaching);
    			if (detaching) detach(t1);
    			destroy_component(ability2, detaching);
    			if (detaching) detach(t2);
    			destroy_component(ability3, detaching);
    			if (detaching) detach(t3);
    			destroy_component(ability4, detaching);
    			if (detaching) detach(t4);
    			destroy_component(ability5, detaching);
    		}
    	};
    }

    function instance$3($$self, $$props, $$invalidate) {
    	let { model } = $$props;
    	let { update } = $$props;

    	function ability0_score_binding(value) {
    		if ($$self.$$.not_equal(model.abilities.strength, value)) {
    			model.abilities.strength = value;
    			$$invalidate(0, model);
    		}
    	}

    	function ability1_score_binding(value) {
    		if ($$self.$$.not_equal(model.abilities.dexterity, value)) {
    			model.abilities.dexterity = value;
    			$$invalidate(0, model);
    		}
    	}

    	function ability2_score_binding(value) {
    		if ($$self.$$.not_equal(model.abilities.constitution, value)) {
    			model.abilities.constitution = value;
    			$$invalidate(0, model);
    		}
    	}

    	function ability3_score_binding(value) {
    		if ($$self.$$.not_equal(model.abilities.intelligence, value)) {
    			model.abilities.intelligence = value;
    			$$invalidate(0, model);
    		}
    	}

    	function ability4_score_binding(value) {
    		if ($$self.$$.not_equal(model.abilities.wisdom, value)) {
    			model.abilities.wisdom = value;
    			$$invalidate(0, model);
    		}
    	}

    	function ability5_score_binding(value) {
    		if ($$self.$$.not_equal(model.abilities.charisma, value)) {
    			model.abilities.charisma = value;
    			$$invalidate(0, model);
    		}
    	}

    	$$self.$$set = $$props => {
    		if ('model' in $$props) $$invalidate(0, model = $$props.model);
    		if ('update' in $$props) $$invalidate(1, update = $$props.update);
    	};

    	return [
    		model,
    		update,
    		ability0_score_binding,
    		ability1_score_binding,
    		ability2_score_binding,
    		ability3_score_binding,
    		ability4_score_binding,
    		ability5_score_binding
    	];
    }

    class Abilities extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$3, create_fragment$3, safe_not_equal, { model: 0, update: 1 });
    	}
    }

    /* src\components\HitPoints.svelte generated by Svelte v3.59.2 */

    function create_fragment$2(ctx) {
    	let div2;
    	let h30;
    	let button0;
    	let t0_value = /*hp*/ ctx[0].current + "";
    	let t0;
    	let t1;
    	let span0;
    	let t3;
    	let h31;
    	let button1;
    	let t4_value = /*hp*/ ctx[0].max + "";
    	let t4;
    	let t5;
    	let span1;
    	let t7;
    	let div0;
    	let button2;
    	let t9;
    	let button3;
    	let t11;
    	let div1;
    	let button4;
    	let t13;
    	let button5;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			div2 = element("div");
    			h30 = element("h3");
    			button0 = element("button");
    			t0 = text(t0_value);
    			t1 = space();
    			span0 = element("span");
    			span0.textContent = "/";
    			t3 = space();
    			h31 = element("h3");
    			button1 = element("button");
    			t4 = text(t4_value);
    			t5 = space();
    			span1 = element("span");
    			span1.textContent = "Hit Points";
    			t7 = space();
    			div0 = element("div");
    			button2 = element("button");
    			button2.textContent = "+";
    			t9 = space();
    			button3 = element("button");
    			button3.textContent = "-";
    			t11 = space();
    			div1 = element("div");
    			button4 = element("button");
    			button4.textContent = "+max";
    			t13 = space();
    			button5 = element("button");
    			button5.textContent = "-max";
    			attr(button0, "class", "btn-dark badge");
    			attr(span0, "class", "ml-2 mr-2 align-self-center");
    			attr(button1, "class", "btn-dark badge");
    			attr(span1, "class", "ml-2 align-self-center");
    			attr(button2, "class", "btn btn-dark align-self-center");
    			attr(button3, "class", "btn btn-dark align-self-center");
    			attr(div0, "class", "btn-group ml-auto");
    			attr(button4, "class", "btn btn-dark align-self-center");
    			attr(button5, "class", "btn btn-dark align-self-center");
    			attr(div1, "class", "btn-group ml-1");
    			attr(div2, "class", "d-flex");
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    			append(div2, h30);
    			append(h30, button0);
    			append(button0, t0);
    			append(div2, t1);
    			append(div2, span0);
    			append(div2, t3);
    			append(div2, h31);
    			append(h31, button1);
    			append(button1, t4);
    			append(div2, t5);
    			append(div2, span1);
    			append(div2, t7);
    			append(div2, div0);
    			append(div0, button2);
    			append(div0, t9);
    			append(div0, button3);
    			append(div2, t11);
    			append(div2, div1);
    			append(div1, button4);
    			append(div1, t13);
    			append(div1, button5);

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*handleCurrent*/ ctx[1]),
    					listen(button1, "click", /*handleMax*/ ctx[2]),
    					listen(button2, "click", /*click_handler*/ ctx[3]),
    					listen(button3, "click", /*click_handler_1*/ ctx[4]),
    					listen(button4, "click", /*click_handler_2*/ ctx[5]),
    					listen(button5, "click", /*click_handler_3*/ ctx[6])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*hp*/ 1 && t0_value !== (t0_value = /*hp*/ ctx[0].current + "")) set_data(t0, t0_value);
    			if (dirty & /*hp*/ 1 && t4_value !== (t4_value = /*hp*/ ctx[0].max + "")) set_data(t4, t4_value);
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div2);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let { hp } = $$props;

    	function handleCurrent(e) {
    		$$invalidate(0, hp.current += e.shiftKey ? -1 : 1, hp);
    	}

    	function handleMax(e) {
    		$$invalidate(0, hp.max += e.shiftKey ? -1 : 1, hp);
    	}

    	const click_handler = () => handleCurrent({ shiftKey: false });
    	const click_handler_1 = () => handleCurrent({ shiftKey: true });
    	const click_handler_2 = () => handleMax({ shiftKey: false });
    	const click_handler_3 = () => handleMax({ shiftKey: true });

    	$$self.$$set = $$props => {
    		if ('hp' in $$props) $$invalidate(0, hp = $$props.hp);
    	};

    	return [
    		hp,
    		handleCurrent,
    		handleMax,
    		click_handler,
    		click_handler_1,
    		click_handler_2,
    		click_handler_3
    	];
    }

    class HitPoints extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, { hp: 0 });
    	}
    }

    /* src\components\Status.svelte generated by Svelte v3.59.2 */

    function create_fragment$1(ctx) {
    	let hitpoints;
    	let t0;
    	let hr;
    	let t1;
    	let abilities;
    	let current;
    	hitpoints = new HitPoints({ props: { hp: /*model*/ ctx[0].hp } });

    	abilities = new Abilities({
    			props: {
    				model: /*model*/ ctx[0],
    				update: /*update*/ ctx[1]
    			}
    		});

    	return {
    		c() {
    			create_component(hitpoints.$$.fragment);
    			t0 = space();
    			hr = element("hr");
    			t1 = space();
    			create_component(abilities.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(hitpoints, target, anchor);
    			insert(target, t0, anchor);
    			insert(target, hr, anchor);
    			insert(target, t1, anchor);
    			mount_component(abilities, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const hitpoints_changes = {};
    			if (dirty & /*model*/ 1) hitpoints_changes.hp = /*model*/ ctx[0].hp;
    			hitpoints.$set(hitpoints_changes);
    			const abilities_changes = {};
    			if (dirty & /*model*/ 1) abilities_changes.model = /*model*/ ctx[0];
    			if (dirty & /*update*/ 2) abilities_changes.update = /*update*/ ctx[1];
    			abilities.$set(abilities_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(hitpoints.$$.fragment, local);
    			transition_in(abilities.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(hitpoints.$$.fragment, local);
    			transition_out(abilities.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(hitpoints, detaching);
    			if (detaching) detach(t0);
    			if (detaching) detach(hr);
    			if (detaching) detach(t1);
    			destroy_component(abilities, detaching);
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { model } = $$props;
    	let { update } = $$props;

    	$$self.$$set = $$props => {
    		if ('model' in $$props) $$invalidate(0, model = $$props.model);
    		if ('update' in $$props) $$invalidate(1, update = $$props.update);
    	};

    	return [model, update];
    }

    class Status extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { model: 0, update: 1 });
    	}
    }

    /* src\App.svelte generated by Svelte v3.59.2 */

    function create_else_block(ctx) {
    	let link;

    	return {
    		c() {
    			link = element("link");
    			attr(link, "rel", "stylesheet");
    			attr(link, "href", "https://cdn.jsdelivr.net/npm/bootstrap@4.6.1/dist/css/bootstrap.min.css");
    			attr(link, "integrity", "sha384-zCbKRCUGaJDkqS1kPbPd7TveP5iyJE0EjAuZQTgFLD2ylzuqKfdKlfG/eSrtxUkn");
    			attr(link, "crossorigin", "anonymous");
    		},
    		m(target, anchor) {
    			insert(target, link, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(link);
    		}
    	};
    }

    // (22:1) {#if theme == 'dark'}
    function create_if_block(ctx) {
    	let link;

    	return {
    		c() {
    			link = element("link");
    			attr(link, "rel", "stylesheet");
    			attr(link, "href", "https://cdn.jsdelivr.net/gh/vinorodrigues/bootstrap-dark@0.6.1/dist/bootstrap-dark.min.css");
    		},
    		m(target, anchor) {
    			insert(target, link, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(link);
    		}
    	};
    }

    // (32:2) <Details open={true} title="Character">
    function create_default_slot_3(ctx) {
    	let bio;
    	let current;
    	bio = new Bio({ props: { model: /*model*/ ctx[0] } });

    	return {
    		c() {
    			create_component(bio.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(bio, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const bio_changes = {};
    			if (dirty & /*model*/ 1) bio_changes.model = /*model*/ ctx[0];
    			bio.$set(bio_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(bio.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(bio.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(bio, detaching);
    		}
    	};
    }

    // (33:2) <Details open={true} title="Status">
    function create_default_slot_2(ctx) {
    	let status;
    	let current;

    	status = new Status({
    			props: {
    				model: /*model*/ ctx[0],
    				update: /*update*/ ctx[1]
    			}
    		});

    	return {
    		c() {
    			create_component(status.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(status, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const status_changes = {};
    			if (dirty & /*model*/ 1) status_changes.model = /*model*/ ctx[0];
    			status.$set(status_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(status.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(status.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(status, detaching);
    		}
    	};
    }

    // (34:2) <Details open={false} title="Inventory">
    function create_default_slot_1(ctx) {
    	let equipment;
    	let current;
    	equipment = new Equipment({ props: { model: /*model*/ ctx[0] } });

    	return {
    		c() {
    			create_component(equipment.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(equipment, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const equipment_changes = {};
    			if (dirty & /*model*/ 1) equipment_changes.model = /*model*/ ctx[0];
    			equipment.$set(equipment_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(equipment.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(equipment.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(equipment, detaching);
    		}
    	};
    }

    // (35:2) <Details open={false} title="Notes">
    function create_default_slot(ctx) {
    	let notes;
    	let current;
    	notes = new Notes({ props: { notes: /*model*/ ctx[0].notes } });

    	return {
    		c() {
    			create_component(notes.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(notes, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const notes_changes = {};
    			if (dirty & /*model*/ 1) notes_changes.notes = /*model*/ ctx[0].notes;
    			notes.$set(notes_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(notes.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(notes.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(notes, detaching);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let if_block_anchor;
    	let t0;
    	let main;
    	let navbar;
    	let updating_model;
    	let t1;
    	let div;
    	let details0;
    	let t2;
    	let details1;
    	let t3;
    	let details2;
    	let t4;
    	let details3;
    	let current;

    	function select_block_type(ctx, dirty) {
    		if (theme == 'dark') return create_if_block;
    		return create_else_block;
    	}

    	let current_block_type = select_block_type();
    	let if_block = current_block_type(ctx);

    	function navbar_model_binding(value) {
    		/*navbar_model_binding*/ ctx[2](value);
    	}

    	let navbar_props = {};

    	if (/*model*/ ctx[0] !== void 0) {
    		navbar_props.model = /*model*/ ctx[0];
    	}

    	navbar = new Navbar({ props: navbar_props });
    	binding_callbacks.push(() => bind(navbar, 'model', navbar_model_binding));

    	details0 = new Details({
    			props: {
    				open: true,
    				title: "Character",
    				$$slots: { default: [create_default_slot_3] },
    				$$scope: { ctx }
    			}
    		});

    	details1 = new Details({
    			props: {
    				open: true,
    				title: "Status",
    				$$slots: { default: [create_default_slot_2] },
    				$$scope: { ctx }
    			}
    		});

    	details2 = new Details({
    			props: {
    				open: false,
    				title: "Inventory",
    				$$slots: { default: [create_default_slot_1] },
    				$$scope: { ctx }
    			}
    		});

    	details3 = new Details({
    			props: {
    				open: false,
    				title: "Notes",
    				$$slots: { default: [create_default_slot] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    			t0 = space();
    			main = element("main");
    			create_component(navbar.$$.fragment);
    			t1 = space();
    			div = element("div");
    			create_component(details0.$$.fragment);
    			t2 = space();
    			create_component(details1.$$.fragment);
    			t3 = space();
    			create_component(details2.$$.fragment);
    			t4 = space();
    			create_component(details3.$$.fragment);
    			attr(div, "class", "row m-2");
    			attr(main, "id", "app");
    		},
    		m(target, anchor) {
    			if_block.m(document.head, null);
    			append(document.head, if_block_anchor);
    			insert(target, t0, anchor);
    			insert(target, main, anchor);
    			mount_component(navbar, main, null);
    			append(main, t1);
    			append(main, div);
    			mount_component(details0, div, null);
    			append(div, t2);
    			mount_component(details1, div, null);
    			append(div, t3);
    			mount_component(details2, div, null);
    			append(div, t4);
    			mount_component(details3, div, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const navbar_changes = {};

    			if (!updating_model && dirty & /*model*/ 1) {
    				updating_model = true;
    				navbar_changes.model = /*model*/ ctx[0];
    				add_flush_callback(() => updating_model = false);
    			}

    			navbar.$set(navbar_changes);
    			const details0_changes = {};

    			if (dirty & /*$$scope, model*/ 9) {
    				details0_changes.$$scope = { dirty, ctx };
    			}

    			details0.$set(details0_changes);
    			const details1_changes = {};

    			if (dirty & /*$$scope, model*/ 9) {
    				details1_changes.$$scope = { dirty, ctx };
    			}

    			details1.$set(details1_changes);
    			const details2_changes = {};

    			if (dirty & /*$$scope, model*/ 9) {
    				details2_changes.$$scope = { dirty, ctx };
    			}

    			details2.$set(details2_changes);
    			const details3_changes = {};

    			if (dirty & /*$$scope, model*/ 9) {
    				details3_changes.$$scope = { dirty, ctx };
    			}

    			details3.$set(details3_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(navbar.$$.fragment, local);
    			transition_in(details0.$$.fragment, local);
    			transition_in(details1.$$.fragment, local);
    			transition_in(details2.$$.fragment, local);
    			transition_in(details3.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(navbar.$$.fragment, local);
    			transition_out(details0.$$.fragment, local);
    			transition_out(details1.$$.fragment, local);
    			transition_out(details2.$$.fragment, local);
    			transition_out(details3.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if_block.d(detaching);
    			detach(if_block_anchor);
    			if (detaching) detach(t0);
    			if (detaching) detach(main);
    			destroy_component(navbar);
    			destroy_component(details0);
    			destroy_component(details1);
    			destroy_component(details2);
    			destroy_component(details3);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	function update() {
    		$$invalidate(0, model);
    	}

    	let model = character();

    	function navbar_model_binding(value) {
    		model = value;
    		$$invalidate(0, model);
    	}

    	return [model, update, navbar_model_binding];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    const app = new App({
    	target: document.body,
    	props: { }
    });

    return app;

})();
