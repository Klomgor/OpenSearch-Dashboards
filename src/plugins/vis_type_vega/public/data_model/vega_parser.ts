/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * The OpenSearch Contributors require contributions made to
 * this file be licensed under the Apache-2.0 license or a
 * compatible open source license.
 *
 * Any modifications Copyright OpenSearch Contributors. See
 * GitHub history for details.
 */

/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import _ from 'lodash';
import schemaParser from 'vega-schema-url-parser';
import versionCompare from 'compare-versions';
import hjson from 'hjson';
import { euiPaletteColorBlind } from '@elastic/eui';
import { euiThemeVars } from '@osd/ui-shared-deps/theme';
import { i18n } from '@osd/i18n';
// @ts-ignore
import { Signal } from 'vega';

// @ts-expect-error TS6133 TODO(ts-error): fixme
import { HttpSetup } from 'opensearch-dashboards/public';
// @ts-expect-error TS7016 TODO(ts-error): fixme
import { vega, vegaLite } from '../lib/vega';
import { OpenSearchQueryParser } from './opensearch_query_parser';
import { Utils } from './utils';
import { EmsFileParser } from './ems_file_parser';
import { UrlParser } from './url_parser';
import { SearchAPI } from './search_api';
import { TimeCache } from './time_cache';
import { IServiceSettings } from '../../../maps_legacy/public';
import { VisAugmenterEmbeddableConfig, VisLayerTypes } from '../../../vis_augmenter/public';
import {
  Bool,
  Data,
  VegaSpec,
  VegaConfig,
  TooltipConfig,
  DstObj,
  UrlParserConfig,
  PendingType,
  ControlsLocation,
  ControlsDirection,
  OpenSearchDashboards,
} from './types';
import { PPLQueryParser } from './ppl_parser';

// Set default single color to match other OpenSearch Dashboards visualizations
const defaultColor: string = euiPaletteColorBlind()[0];

const locToDirMap: Record<string, ControlsLocation> = {
  left: 'row-reverse',
  right: 'row',
  top: 'column-reverse',
  bottom: 'column',
};

// If there is no "%type%" parameter, use this parser
const DEFAULT_PARSER: string = 'opensearch';

export class VegaParser {
  spec: VegaSpec;
  hideWarnings: boolean;
  error?: string;
  warnings: string[];
  _urlParsers: UrlParserConfig | undefined;
  isVegaLite?: boolean;
  useHover?: boolean;
  _config?: VegaConfig;
  useMap?: boolean;
  renderer?: string;
  tooltips?: boolean | TooltipConfig;
  mapConfig?: object;
  vlspec?: VegaSpec;
  useResize?: boolean;
  containerDir?: ControlsLocation | ControlsDirection;
  controlsDir?: ControlsLocation;
  searchAPI: SearchAPI;
  getServiceSettings: () => Promise<IServiceSettings>;
  filters: Bool;
  timeCache: TimeCache;
  visibleVisLayers: Map<VisLayerTypes, boolean>;
  visAugmenterConfig: VisAugmenterEmbeddableConfig;

  constructor(
    spec: VegaSpec | string,
    searchAPI: SearchAPI,
    timeCache: TimeCache,
    filters: Bool,
    getServiceSettings: () => Promise<IServiceSettings>
  ) {
    this.spec = spec as VegaSpec;
    this.hideWarnings = false;
    this.visibleVisLayers = new Map<VisLayerTypes, boolean>();
    this.visAugmenterConfig = {} as VisAugmenterEmbeddableConfig;

    this.error = undefined;
    this.warnings = [];
    this.searchAPI = searchAPI;
    this.getServiceSettings = getServiceSettings;
    this.filters = filters;
    this.timeCache = timeCache;
  }

  async parseAsync() {
    try {
      await this._parseAsync();
    } catch (err) {
      // if we reject current promise, it will use the standard OpenSearch Dashboards error handling
      this.error = Utils.formatErrorToStr(err);
    }
    return this;
  }

  async _parseAsync() {
    if (this.isVegaLite !== undefined) throw new Error();

    if (typeof this.spec === 'string') {
      const spec = hjson.parse(this.spec, { legacyRoot: false });

      if (!spec.$schema) {
        throw new Error(
          i18n.translate('visTypeVega.vegaParser.inputSpecDoesNotSpecifySchemaErrorMessage', {
            defaultMessage: `Your specification requires a {schemaParam} field with a valid URL for
Vega (see {vegaSchemaUrl}) or
Vega-Lite (see {vegaLiteSchemaUrl}).
The URL is an identifier only. OpenSearch Dashboards and your browser will never access this URL.`,
            values: {
              schemaParam: '"$schema"',
              vegaLiteSchemaUrl: 'https://vega.github.io/vega-lite/docs/spec.html#top-level',
              vegaSchemaUrl:
                'https://vega.github.io/vega/docs/specification/#top-level-specification-properties',
            },
          })
        );
      }
      this.spec = spec;
    }

    if (!_.isPlainObject(this.spec)) {
      throw new Error(
        i18n.translate('visTypeVega.vegaParser.invalidVegaSpecErrorMessage', {
          defaultMessage: 'Invalid Vega specification',
        })
      );
    }
    this.isVegaLite = this.parseSchema(this.spec).isVegaLite;
    this.useHover = !this.isVegaLite;

    this._config = this._parseConfig();
    this.hideWarnings = !!this._config.hideWarnings;
    this.visibleVisLayers = this._config.visibleVisLayers;
    this.visAugmenterConfig = this._config.visAugmenterConfig;
    this.useMap = this._config.type === 'map';
    this.renderer = this._config.renderer === 'svg' ? 'svg' : 'canvas';
    this.tooltips = this._parseTooltips();

    this._setDefaultColors();
    this._parseControlPlacement();
    if (this.useMap) {
      this.mapConfig = this._parseMapConfig();
      this.useResize = false;
    } else if (this.spec) {
      this._compileWithAutosize();
    }

    await this._resolveDataUrls();

    if (this.isVegaLite) {
      this._compileVegaLite();
    }
  }

  /**
   * Ensure that Vega and Vega-Lite will take the full width of the container unless
   * the user has explicitly disabled this setting by setting it to "none".
   * Also sets the default width to include the padding. This creates the least configuration
   * needed for most cases, with the option to do more.
   */
  private _compileWithAutosize() {
    const defaultAutosize = {
      type: 'fit',
      contains: 'padding',
    };

    // If we are showing PointInTimeEventsVisLayers, it means we are showing a base vis + event vis.
    // Because this will be using a vconcat spec, we cannot use the default autosize settings, or set
    // top-level height/width values.
    // See limitations: https://vega.github.io/vega-lite/docs/size.html#limitations
    const showPointInTimeEvents =
      this.visibleVisLayers?.get(VisLayerTypes.PointInTimeEvents) === true;

    let autosize = this.spec.autosize;
    let useResize = true;

    if (!this.isVegaLite && autosize && typeof autosize === 'object' && 'signal' in autosize) {
      // Vega supports dynamic autosize information, so we ignore it
      return;
    }

    if (!autosize && typeof autosize !== 'undefined') {
      this._onWarning(
        i18n.translate('visTypeVega.vegaParser.autoSizeDoesNotAllowFalse', {
          defaultMessage:
            '{autoSizeParam} is enabled, it can only be disabled by setting {autoSizeParam} to {noneParam}',
          values: {
            autoSizeParam: '"autosize"',
            noneParam: '"none"',
          },
        })
      );
    }

    if (typeof autosize === 'string') {
      useResize = autosize !== 'none';
      autosize = { ...defaultAutosize, type: autosize };
    } else if (typeof autosize === 'object') {
      autosize = { ...defaultAutosize, ...autosize } as {
        type: string;
        contains: string;
      };
      useResize = Boolean(autosize?.type && autosize?.type !== 'none');
    } else if (showPointInTimeEvents) {
      autosize = undefined;
    } else {
      autosize = defaultAutosize;
    }

    if (
      useResize &&
      ((this.spec.width && this.spec.width !== 'container') ||
        (this.spec.height && this.spec.height !== 'container'))
    ) {
      this._onWarning(
        i18n.translate('visTypeVega.vegaParser.widthAndHeightParamsAreIgnored', {
          defaultMessage:
            '{widthParam} and {heightParam} params are ignored because {autoSizeParam} is enabled. Set {autoSizeParam}: {noneParam} to disable',
          values: {
            widthParam: '"width"',
            heightParam: '"height"',
            autoSizeParam: '"autosize"',
            noneParam: '"none"',
          },
        })
      );
    }

    if (useResize && !showPointInTimeEvents) {
      this.spec.width = 'container';
      this.spec.height = 'container';
    }

    this.spec.autosize = autosize;
    this.useResize = useResize;
  }

  /**
   * Convert VegaLite to Vega spec
   */
  private _compileVegaLite() {
    this.vlspec = this.spec;
    const logger = vega.logger(vega.Warn); // note: eslint has a false positive here
    logger.warn = this._onWarning.bind(this);
    this.spec = vegaLite.compile(this.vlspec, logger).spec;

    // When using VL with the type=map and user did not provid their own projection settings,
    // remove the default projection that was generated by VegaLite compiler.
    // This way we let leaflet-vega library inject a different default projection for tile maps.
    // Also, VL injects default padding and autosize values, but neither should be set for vega-leaflet.
    if (this.useMap) {
      if (!this.spec || !this.vlspec) return;
      const hasConfig = _.isPlainObject(this.vlspec.config);
      if (this.vlspec.config === undefined || (hasConfig && !this.vlspec.config.projection)) {
        // Assume VL generates spec.projections = an array of exactly one object named 'projection'
        if (
          !Array.isArray(this.spec.projections) ||
          this.spec.projections.length !== 1 ||
          this.spec.projections[0].name !== 'projection'
        ) {
          throw new Error(
            i18n.translate(
              'visTypeVega.vegaParser.VLCompilerShouldHaveGeneratedSingleProtectionObjectErrorMessage',
              {
                defaultMessage:
                  'Internal error: Vega-Lite compiler should have generated a single projection object',
              }
            )
          );
        }
        delete this.spec.projections;
      }

      // todo: sizing cleanup might need to be rethought and consolidated
      if (!this.vlspec.width) delete this.spec.width;
      if (!this.vlspec.height) delete this.spec.height;
      if (
        !this.vlspec.padding &&
        (this.vlspec.config === undefined || (hasConfig && !this.vlspec.config.padding))
      ) {
        delete this.spec.padding;
      }
      if (
        !this.vlspec.autosize &&
        (this.vlspec.config === undefined || (hasConfig && !this.vlspec.config.autosize))
      ) {
        delete this.spec.autosize;
      }
    }

    if (this._config?.signals) {
      Object.entries(this._config?.signals).forEach(([markId, signals]: [string, any]) => {
        const mark = this.getMarkWithStyle(this.spec.marks, markId);

        if (mark) {
          signals.forEach((signal: Signal) => {
            signal.on?.forEach((eventObj) => {
              // We are prepending mark name here so that the signals only listens to the events on
              // the elements related to this mark
              eventObj.events = `@${mark.name}:${eventObj.events}`;
            });
          });
          this.spec.signals = (this.spec.signals || []).concat(signals);
        }
      });
    }
  }

  /**
   * This method recursively looks for a mark that includes the given style.
   * Returns undefined if it doesn't find it.
   */
  getMarkWithStyle(marks: any[], style: string): any {
    if (!marks) {
      return undefined;
    }

    if (Array.isArray(marks)) {
      const markWithStyle = marks.find((mark) => {
        return mark.style?.includes(style);
      });

      if (markWithStyle) {
        return markWithStyle;
      }

      for (let i = 0; i < marks.length; i++) {
        const res = this.getMarkWithStyle(marks[i].marks, style);
        if (res) {
          return res;
        }
      }

      return undefined;
    }
  }

  /**
   * Calculate container-direction CSS property for binding placement
   * @private
   */
  _parseControlPlacement() {
    this.containerDir = this._config?.controlsLocation
      ? locToDirMap[this._config.controlsLocation]
      : undefined;
    if (this.containerDir === undefined) {
      if (this._config && this._config.controlsLocation === undefined) {
        this.containerDir = 'column';
      } else {
        throw new Error(
          i18n.translate('visTypeVega.vegaParser.unrecognizedControlsLocationValueErrorMessage', {
            defaultMessage:
              'Unrecognized {controlsLocationParam} value. Expecting one of [{locToDirMap}]',
            values: {
              locToDirMap: `"${Object.keys(locToDirMap).join('", "')}"`,
              controlsLocationParam: 'controlsLocation',
            },
          })
        );
      }
    }
    const dir = this._config?.controlsDirection;
    if (dir !== undefined && dir !== 'horizontal' && dir !== 'vertical') {
      throw new Error(
        i18n.translate('visTypeVega.vegaParser.unrecognizedDirValueErrorMessage', {
          defaultMessage: 'Unrecognized {dirParam} value. Expecting one of [{expectedValues}]',
          values: { expectedValues: '"horizontal", "vertical"', dirParam: 'dir' },
        })
      );
    }
    this.controlsDir = dir === 'horizontal' ? 'row' : 'column';
  }

  /**
   * Parse {config: opensearchDashboards: {...}} portion of the Vega spec (or root-level _hostConfig for backward compat)
   * @returns {object} opensearchDashboards config
   * @private
   */
  _parseConfig(): OpenSearchDashboards | {} {
    let result: OpenSearchDashboards | null = null;
    if (this.spec) {
      if (this.spec._hostConfig !== undefined) {
        result = this.spec._hostConfig;
        delete this.spec._hostConfig;
        if (!_.isPlainObject(result)) {
          throw new Error(
            i18n.translate('visTypeVega.vegaParser.hostConfigValueTypeErrorMessage', {
              defaultMessage: 'If present, {configName} must be an object',
              values: { configName: '"_hostConfig"' },
            })
          );
        }
        this._onWarning(
          i18n.translate('visTypeVega.vegaParser.hostConfigIsDeprecatedWarningMessage', {
            defaultMessage:
              '{deprecatedConfigName} has been deprecated. Use {newConfigName} instead.',
            values: {
              deprecatedConfigName: '"_hostConfig"',
              newConfigName: 'config.kibana',
            },
          })
        );
      }
      if (_.isPlainObject(this.spec.config) && this.spec.config.kibana !== undefined) {
        result = this.spec.config.kibana;
        delete this.spec.config.kibana;
        if (!_.isPlainObject(result)) {
          throw new Error(
            i18n.translate(
              'visTypeVega.vegaParser.opensearchDashboardsConfigValueTypeErrorMessage',
              {
                defaultMessage: 'If present, {configName} must be an object',
                values: { configName: 'config.kibana' },
              }
            )
          );
        }
        // Converting the visibleVisLayers array back to a map
        if (result.visibleVisLayers !== undefined && Array.isArray(result.visibleVisLayers)) {
          result.visibleVisLayers = new Map<VisLayerTypes, boolean>(result.visibleVisLayers);
        }
      }
    }
    return result || {};
  }

  _parseTooltips() {
    if (this._config && this._config.tooltips === false) {
      return false;
    }

    const result: TooltipConfig = (this._config?.tooltips as TooltipConfig) || {};

    if (result.position === undefined) {
      result.position = 'top';
    } else if (['top', 'right', 'bottom', 'left'].indexOf(result.position) === -1) {
      throw new Error(
        i18n.translate(
          'visTypeVega.vegaParser.unexpectedValueForPositionConfigurationErrorMessage',
          {
            defaultMessage: 'Unexpected value for the {configurationName} configuration',
            values: { configurationName: 'result.position' },
          }
        )
      );
    }

    if (result.padding === undefined) {
      result.padding = 16;
    } else if (typeof result.padding !== 'number') {
      throw new Error(
        i18n.translate('visTypeVega.vegaParser.paddingConfigValueTypeErrorMessage', {
          defaultMessage: '{configName} is expected to be a number',
          values: { configName: 'config.kibana.result.padding' },
        })
      );
    }

    if (result.centerOnMark === undefined) {
      // if mark's width & height is less than this value, center on it
      result.centerOnMark = 50;
    } else if (typeof result.centerOnMark === 'boolean') {
      result.centerOnMark = result.centerOnMark ? Number.MAX_VALUE : -1;
    } else if (typeof result.centerOnMark !== 'number') {
      throw new Error(
        i18n.translate('visTypeVega.vegaParser.centerOnMarkConfigValueTypeErrorMessage', {
          defaultMessage: '{configName} is expected to be {trueValue}, {falseValue}, or a number',
          values: {
            configName: 'config.kibana.result.centerOnMark',
            trueValue: 'true',
            falseValue: 'false',
          },
        })
      );
    }

    return result;
  }

  /**
   * Parse map-specific configuration
   * @returns {{mapStyle: *|string, delayRepaint: boolean, latitude: number, longitude: number, zoom, minZoom, maxZoom, zoomControl: *|boolean, maxBounds: *}}
   * @private
   */
  _parseMapConfig() {
    const res: VegaConfig = {
      delayRepaint: this._config?.delayRepaint === undefined ? true : this._config.delayRepaint,
    };

    const validate = (name: string, isZoom: boolean) => {
      const val = this._config ? this._config[name] : undefined;
      if (val !== undefined) {
        const parsed = parseFloat(val);
        if (Number.isFinite(parsed) && (!isZoom || (parsed >= 0 && parsed <= 30))) {
          res[name] = parsed;
          return;
        }
        this._onWarning(
          i18n.translate(
            'visTypeVega.vegaParser.someOpenSearchDashboardsurationIsNoValidWarningMessage',
            {
              defaultMessage: '{configName} is not valid',
              values: { configName: `config.kibana.${name}` },
            }
          )
        );
      }
      if (!isZoom) res[name] = 0;
    };

    validate(`latitude`, false);
    validate(`longitude`, false);
    validate(`zoom`, true);
    validate(`minZoom`, true);
    validate(`maxZoom`, true);

    // `false` is a valid value
    res.mapStyle = this._config?.mapStyle === undefined ? `default` : this._config.mapStyle;
    if (res.mapStyle !== `default` && res.mapStyle !== false) {
      this._onWarning(
        i18n.translate('visTypeVega.vegaParser.mapStyleValueTypeWarningMessage', {
          defaultMessage:
            '{mapStyleConfigName} may either be {mapStyleConfigFirstAllowedValue} or {mapStyleConfigSecondAllowedValue}',
          values: {
            mapStyleConfigName: 'config.kibana.mapStyle',
            mapStyleConfigFirstAllowedValue: 'false',
            mapStyleConfigSecondAllowedValue: '"default"',
          },
        })
      );
      res.mapStyle = `default`;
    }

    this._parseBool('zoomControl', res, true);
    this._parseBool('scrollWheelZoom', res, false);

    const maxBounds = this._config?.maxBounds;
    if (maxBounds !== undefined) {
      if (
        !Array.isArray(maxBounds) ||
        maxBounds.length !== 4 ||
        !maxBounds.every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        this._onWarning(
          i18n.translate('visTypeVega.vegaParser.maxBoundsValueTypeWarningMessage', {
            defaultMessage: '{maxBoundsConfigName} must be an array with four numbers',
            values: {
              maxBoundsConfigName: 'config.kibana.maxBounds',
            },
          })
        );
      } else {
        res.maxBounds = maxBounds;
      }
    }

    return res;
  }

  _parseBool(paramName: string, dstObj: DstObj, dflt: boolean | string | number) {
    const val = this._config ? this._config[paramName] : undefined;
    if (val === undefined) {
      dstObj[paramName] = dflt;
    } else if (typeof val !== 'boolean') {
      this._onWarning(
        i18n.translate(
          'visTypeVega.vegaParser.someOpenSearchDashboardsParamValueTypeWarningMessage',
          {
            defaultMessage: '{configName} must be a boolean value',
            values: {
              configName: `config.kibana.${paramName}`,
            },
          }
        )
      );
      dstObj[paramName] = dflt;
    } else {
      dstObj[paramName] = val;
    }
  }

  /**
   * Parse Vega schema element
   * @returns {object} isVegaLite, libVersion
   * @private
   */
  private parseSchema(spec: VegaSpec) {
    const schema = schemaParser(spec.$schema);
    const isVegaLite = schema.library === 'vega-lite';
    const libVersion = isVegaLite ? vegaLite.version : vega.version;

    if (versionCompare(schema.version, libVersion) > 0) {
      this._onWarning(
        i18n.translate('visTypeVega.vegaParser.notValidLibraryVersionForInputSpecWarningMessage', {
          defaultMessage:
            'The input spec uses {schemaLibrary} {schemaVersion}, but current version of {schemaLibrary} is {libraryVersion}.',
          values: {
            schemaLibrary: schema.library,
            schemaVersion: schema.version,
            libraryVersion: libVersion,
          },
        })
      );
    }

    return { isVegaLite, libVersion };
  }

  /**
   * Replace all instances of OpenSearch requests with raw values.
   * Also handle any other type of url: {type: xxx, ...}
   * @private
   */
  async _resolveDataUrls() {
    if (!this._urlParsers) {
      const serviceSettings = await this.getServiceSettings();
      const onWarn = this._onWarning.bind(this);
      this._urlParsers = {
        opensearch: new OpenSearchQueryParser(this.timeCache, this.searchAPI, this.filters, onWarn),
        emsfile: new EmsFileParser(serviceSettings),
        url: new UrlParser(onWarn),
        ppl: new PPLQueryParser(this.timeCache, this.searchAPI),
      };
    }
    const pending: PendingType = {};

    this.searchAPI.resetSearchStats();

    this._findObjectDataUrls(this.spec!, (obj: Data) => {
      const url = obj.url;
      delete obj.url;
      let type = url!['%type%'];
      delete url!['%type%'];
      if (type === undefined) {
        type = DEFAULT_PARSER;
      }

      const parser = this._urlParsers![type];
      if (parser === undefined) {
        throw new Error(
          i18n.translate('visTypeVega.vegaParser.notSupportedUrlTypeErrorMessage', {
            defaultMessage: '{urlObject} is not supported',
            values: {
              urlObject: `url: {"%type%": "${type}"}`,
            },
          })
        );
      }

      let pendingArr = pending[type];
      if (pendingArr === undefined) {
        pending[type] = pendingArr = [];
      }

      pendingArr.push(parser.parseUrl(obj, url));
    });

    const pendingParsers = Object.keys(pending);
    if (pendingParsers.length > 0) {
      // let each parser populate its data in parallel
      await Promise.all(
        pendingParsers.map((type) => this._urlParsers![type].populateData(pending[type]))
      );
    }
  }

  /**
   * Recursively find and callback every instance of the data.url as an object
   * @param {*} obj current location in the object tree
   * @param {function({object})} onFind Call this function for all url objects
   * @param {string} [key] field name of the current object
   * @private
   */

  _findObjectDataUrls(obj: VegaSpec | Data, onFind: (data: Data) => void, key?: unknown) {
    if (Array.isArray(obj)) {
      for (const elem of obj) {
        this._findObjectDataUrls(elem, onFind, key);
      }
    } else if (_.isPlainObject(obj)) {
      if (key === 'data' && _.isPlainObject(obj.url)) {
        // Assume that any  "data": {"url": {...}}  is a request for data
        if (obj.values !== undefined || obj.source !== undefined) {
          throw new Error(
            i18n.translate(
              'visTypeVega.vegaParser.dataExceedsSomeParamsUseTimesLimitErrorMessage',
              {
                defaultMessage:
                  'Data must not have more than one of {urlParam}, {valuesParam}, and {sourceParam}',
                values: {
                  urlParam: '"url"',
                  valuesParam: '"values"',
                  sourceParam: '"source"',
                },
              }
            )
          );
        }
        onFind(obj as Data);
      } else {
        for (const k of Object.keys(obj)) {
          this._findObjectDataUrls(obj[k], onFind, k);
        }
      }
    }
  }

  /**
   * Inject default colors into the spec.config
   * @private
   */
  _setDefaultColors() {
    // Default category coloring to the OpenSearch color scheme
    this._setDefaultValue(euiPaletteColorBlind(), 'config', 'range', 'category');

    if (this.isVegaLite) {
      // Vega-Lite: set default color, works for fill and strike --  config: { mark:  { color: '#54B399' }}
      this._setDefaultValue(defaultColor, 'config', 'mark', 'color');
      // By default text marks should use theme-aware text color
      this._setDefaultValue(euiThemeVars.euiTextColor, 'config', 'text', 'fill');
    } else {
      // Vega - global mark has very strange behavior, must customize each mark type individually
      // https://github.com/vega/vega/issues/1083
      // Don't set defaults if spec.config.mark.color or fill are set
      if (
        !this.spec?.config.mark ||
        (this.spec.config.mark.color === undefined && this.spec.config.mark.fill === undefined)
      ) {
        this._setDefaultValue(defaultColor, 'config', 'arc', 'fill');
        this._setDefaultValue(defaultColor, 'config', 'area', 'fill');
        this._setDefaultValue(defaultColor, 'config', 'line', 'stroke');
        this._setDefaultValue(defaultColor, 'config', 'path', 'stroke');
        this._setDefaultValue(defaultColor, 'config', 'rect', 'fill');
        this._setDefaultValue(defaultColor, 'config', 'rule', 'stroke');
        this._setDefaultValue(defaultColor, 'config', 'shape', 'stroke');
        this._setDefaultValue(defaultColor, 'config', 'symbol', 'fill');
        // By default text marks should use theme-aware text color
        this._setDefaultValue(euiThemeVars.euiTextColor, 'config', 'text', 'fill');
        this._setDefaultValue(defaultColor, 'config', 'trail', 'fill');
      }
    }

    // provide right colors for light and dark themes
    this._setDefaultValue(euiThemeVars.euiColorDarkestShade, 'config', 'title', 'color');
    this._setDefaultValue(euiThemeVars.euiColorDarkShade, 'config', 'style', 'guide-label', 'fill');
    this._setDefaultValue(
      euiThemeVars.euiColorDarkestShade,
      'config',
      'style',
      'guide-title',
      'fill'
    );
    this._setDefaultValue(
      euiThemeVars.euiColorDarkestShade,
      'config',
      'style',
      'group-title',
      'fill'
    );
    this._setDefaultValue(
      euiThemeVars.euiColorDarkestShade,
      'config',
      'style',
      'group-subtitle',
      'fill'
    );
    this._setDefaultValue(euiThemeVars.euiColorChartLines, 'config', 'axis', 'tickColor');
    this._setDefaultValue(euiThemeVars.euiColorChartLines, 'config', 'axis', 'domainColor');
    this._setDefaultValue(euiThemeVars.euiColorChartLines, 'config', 'axis', 'gridColor');
    this._setDefaultValue('transparent', 'config', 'background');
  }

  /**
   * Set default value if it doesn't exist.
   * Given an object, and an array of fields, ensure that obj.fld1.fld2. ... .fldN is set to value if it doesn't exist.
   * @param {*} value
   * @param {string} fields
   * @private
   */
  _setDefaultValue(value: unknown, ...fields: string[]) {
    let o = this.spec;
    for (let i = 0; i < fields.length - 1; i++) {
      const field = fields[i];
      const subObj = o[field];
      if (subObj === undefined) {
        o[field] = {};
      } else if (!_.isPlainObject(subObj)) {
        return;
      }
      o = o[field];
    }
    const lastField = fields[fields.length - 1];
    if (o[lastField] === undefined) {
      o[lastField] = value;
    }
  }

  /**
   * Add a warning to the warnings array
   * @private
   */
  _onWarning(...args: any[]) {
    if (!this.hideWarnings) {
      this.warnings.push(Utils.formatWarningToStr(args));
      return Utils.formatWarningToStr(args);
    }
  }
}
