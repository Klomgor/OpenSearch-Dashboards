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

import _, { each, reject } from 'lodash';
import { FieldFormatsContentType, SavedObjectsClientCommon } from '../..';
import { DuplicateField } from '../../../../opensearch_dashboards_utils/common';

import { SerializedFieldFormat } from '../../../../expressions/common';
import { FieldFormatNotFoundError } from '../../field_formats';
import { IFieldType } from '../fields/types';
import { OPENSEARCH_FIELD_TYPES, OSD_FIELD_TYPES } from '../../osd_field_types/types';
import { IIndexPattern } from '../types';
import { FieldFormat, FieldFormatsStartCommon } from '../../field_formats';
import { IIndexPatternFieldList, IndexPatternField, fieldList } from '../fields';
import {
  IndexPatternFieldMap,
  IndexPatternSpec,
  SavedObjectReference,
  SourceFilter,
  TypeMeta,
} from '../types';
import { flattenHitWrapper } from './flatten_hit';
import { formatHitProvider } from './format_hit';

interface IndexPatternDeps {
  spec?: IndexPatternSpec;
  savedObjectsClient: SavedObjectsClientCommon;
  fieldFormats: FieldFormatsStartCommon;
  shortDotsEnable: boolean;
  metaFields: string[];
}

interface SavedObjectBody {
  title?: string;
  displayName?: string;
  description?: string;
  timeFieldName?: string;
  intervalName?: string;
  fields?: string;
  sourceFilters?: string;
  fieldFormatMap?: string;
  typeMeta?: string;
  type?: string;
}

type FormatFieldFn = (
  hit: Record<string, any>,
  fieldName: string,
  type?: FieldFormatsContentType
) => any;

const DATA_SOURCE_REFERNECE_NAME = 'dataSource';
export class IndexPattern implements IIndexPattern {
  public id?: string;
  public title: string = '';
  public displayName?: string;
  public description?: string;
  public fieldFormatMap: Record<string, any>;
  public typeMeta?: TypeMeta;
  public fields: IIndexPatternFieldList & { toSpec: () => IndexPatternFieldMap };
  public timeFieldName: string | undefined;
  public intervalName: string | undefined;
  public type: string | undefined;
  public formatHit: {
    (hit: Record<string, any>, type?: FieldFormatsContentType): any;
    formatField: FormatFieldFn;
  };
  public formatField: FormatFieldFn;
  public flattenHit: (hit: Record<string, any>, deep?: boolean) => Record<string, any>;
  public metaFields: string[];
  // savedObject version
  public version: string | undefined;
  public sourceFilters?: SourceFilter[];
  public dataSourceRef?: SavedObjectReference;
  public fieldsLoading?: boolean;
  private originalSavedObjectBody: SavedObjectBody = {};
  private shortDotsEnable: boolean = false;
  private fieldFormats: FieldFormatsStartCommon;

  constructor({
    spec = {},
    fieldFormats,
    shortDotsEnable = false,
    metaFields = [],
  }: IndexPatternDeps) {
    // set dependencies
    this.fieldFormats = fieldFormats;
    // set config
    this.shortDotsEnable = shortDotsEnable;
    this.metaFields = metaFields;
    // initialize functionality
    this.fields = fieldList([], this.shortDotsEnable);

    this.flattenHit = flattenHitWrapper(this, metaFields);
    this.formatHit = formatHitProvider(
      this,
      fieldFormats.getDefaultInstance(OSD_FIELD_TYPES.STRING)
    );
    this.formatField = this.formatHit.formatField;

    // set values
    this.id = spec.id;
    const fieldFormatMap = this.fieldSpecsToFieldFormatMap(spec.fields);

    this.version = spec.version;

    this.title = spec.title || '';
    this.displayName = spec.displayName;
    this.description = spec.description;
    this.timeFieldName = spec.timeFieldName;
    this.sourceFilters = spec.sourceFilters;

    this.fields.replaceAll(Object.values(spec.fields || {}));
    this.type = spec.type;
    this.typeMeta = spec.typeMeta;

    this.fieldFormatMap = _.mapValues(fieldFormatMap, (mapping) => {
      return this.deserializeFieldFormatMap(mapping);
    });
    this.dataSourceRef = spec.dataSourceRef;
    this.fieldsLoading = spec.fieldsLoading;
  }

  /**
   * Get last saved saved object fields
   */
  getOriginalSavedObjectBody = () => ({ ...this.originalSavedObjectBody });

  /**
   * Reset last saved saved object fields. used after saving
   */
  resetOriginalSavedObjectBody = () => {
    this.originalSavedObjectBody = this.getAsSavedObjectBody();
  };

  /**
   * Converts field format spec to field format instance
   * @param mapping
   */
  private deserializeFieldFormatMap(mapping: SerializedFieldFormat<Record<string, any>>) {
    try {
      return this.fieldFormats.getInstance(mapping.id as string, mapping.params);
    } catch (err) {
      if (err instanceof FieldFormatNotFoundError) {
        return undefined;
      } else {
        throw err;
      }
    }
  }

  /**
   * Extracts FieldFormatMap from FieldSpec map
   * @param fldList FieldSpec map
   */
  private fieldSpecsToFieldFormatMap = (fldList: IndexPatternSpec['fields'] = {}) =>
    Object.values(fldList).reduce<Record<string, SerializedFieldFormat>>((col, fieldSpec) => {
      if (fieldSpec.format) {
        col[fieldSpec.name] = { ...fieldSpec.format };
      }
      return col;
    }, {});

  getComputedFields() {
    const scriptFields: any = {};
    if (!this.fields) {
      return {
        storedFields: ['*'],
        scriptFields,
        docvalueFields: [],
      };
    }

    // Date value returned in "_source" could be in any number of formats
    // Use a docvalue for each date field to ensure standardized formats when working with date fields
    // indexPattern.flattenHit will override "_source" values when the same field is also defined in "fields"
    const docvalueFields = reject(this.fields.getByType('date'), 'scripted').map(
      (dateField: any) => {
        return {
          field: dateField.name,
          format:
            dateField.esTypes && dateField.esTypes.indexOf('date_nanos') !== -1
              ? 'strict_date_time'
              : 'date_time',
        };
      }
    );

    each(this.getScriptedFields(), function (field) {
      scriptFields[field.name] = {
        script: {
          source: field.script,
          lang: field.lang,
        },
      };
    });

    return {
      storedFields: ['*'],
      scriptFields,
      docvalueFields,
    };
  }

  public toSpec(): IndexPatternSpec {
    return {
      id: this.id,
      version: this.version,
      title: this.title,
      displayName: this.displayName,
      description: this.description,
      timeFieldName: this.timeFieldName,
      sourceFilters: this.sourceFilters,
      fields: this.fields.toSpec({ getFormatterForField: this.getFormatterForField.bind(this) }),
      typeMeta: this.typeMeta,
      type: this.type,
      dataSourceRef: this.dataSourceRef,
    };
  }

  /**
   * The display name of the index pattern. If the index pattern has a name, it will return that;
   * otherwise, it will return the title.
   */
  getDisplayName(): string {
    return this.displayName || this.title;
  }

  /**
   * Get the source filtering configuration for that index.
   */
  getSourceFiltering() {
    return {
      excludes: (this.sourceFilters && this.sourceFilters.map((filter: any) => filter.value)) || [],
    };
  }

  /**
   * Add scripted field to field list
   *
   * @param name field name
   * @param script script code
   * @param fieldType
   */
  async addScriptedField(name: string, script: string, fieldType: string = 'string') {
    const scriptedFields = this.getScriptedFields();
    const names = _.map(scriptedFields, 'name');

    if (_.includes(names, name)) {
      throw new DuplicateField(name);
    }

    this.fields.add({
      name,
      script,
      type: fieldType,
      scripted: true,
      lang: 'painless',
      aggregatable: true,
      searchable: true,
      count: 0,
      readFromDocValues: false,
    });
  }

  /**
   * Remove scripted field from field list
   * @param fieldName
   */
  removeScriptedField(fieldName: string) {
    const field = this.fields.getByName(fieldName);
    if (field) {
      this.fields.remove(field);
    }
  }

  getNonScriptedFields() {
    return [...this.fields.getAll().filter((field) => !field.scripted)];
  }

  getScriptedFields() {
    return [...this.fields.getAll().filter((field) => field.scripted)];
  }

  getIndex() {
    if (!this.isUnsupportedTimePattern()) {
      return this.title;
    }

    // Take a time-based interval index pattern title (like [foo-]YYYY.MM.DD[-bar]) and turn it
    // into the actual index (like foo-*-bar) by replacing anything not inside square brackets
    // with a *.
    const regex = /\[[^\]]*]/g; // Matches text inside brackets
    const splits = this.title.split(regex); // e.g. ['', 'YYYY.MM.DD', ''] from the above example
    const matches = this.title.match(regex) || []; // e.g. ['[foo-]', '[-bar]'] from the above example
    return splits
      .map((split, i) => {
        const match = i >= matches.length ? '' : matches[i].replace(/[\[\]]/g, '');
        return `${split.length ? '*' : ''}${match}`;
      })
      .join('');
  }

  isUnsupportedTimePattern(): boolean {
    return !!this.intervalName;
  }

  isTimeBased(): boolean {
    return !!this.timeFieldName && (!this.fields || !!this.getTimeField());
  }

  isTimeNanosBased(): boolean {
    const timeField: any = this.getTimeField();
    return timeField && timeField.esTypes && timeField.esTypes.indexOf('date_nanos') !== -1;
  }

  getTimeField() {
    if (!this.timeFieldName || !this.fields || !this.fields.getByName) return undefined;
    return this.fields.getByName(this.timeFieldName);
  }

  getFieldByName(name: string): IndexPatternField | undefined {
    if (!this.fields || !this.fields.getByName) return undefined;
    return this.fields.getByName(name);
  }

  getAggregationRestrictions() {
    return this.typeMeta?.aggs;
  }

  /**
   * Returns index pattern as saved object body for saving
   */
  getAsSavedObjectBody() {
    const serializeFieldFormatMap = (
      flat: any,
      format: FieldFormat | undefined,
      field: string | undefined
    ) => {
      if (format && field) {
        flat[field] = format;
      }
    };
    const serialized = _.transform(this.fieldFormatMap, serializeFieldFormatMap);
    const fieldFormatMap = _.isEmpty(serialized) ? undefined : JSON.stringify(serialized);

    return {
      title: this.title,
      displayName: this.displayName,
      description: this.description,
      timeFieldName: this.timeFieldName,
      intervalName: this.intervalName,
      sourceFilters: this.sourceFilters ? JSON.stringify(this.sourceFilters) : undefined,
      fields: this.fields ? JSON.stringify(this.fields) : undefined,
      fieldFormatMap,
      type: this.type,
      typeMeta: this.typeMeta ? JSON.stringify(this.typeMeta) : undefined,
    };
  }

  getSaveObjectReference = () => {
    return this.dataSourceRef
      ? [
          {
            id: this.dataSourceRef.id,
            type: this.dataSourceRef.type,
            name: DATA_SOURCE_REFERNECE_NAME,
          },
        ]
      : [];
  };

  setFieldsLoading = (status: boolean) => {
    return (this.fieldsLoading = status);
  };

  // DQL and Lucene already calling this formatter, we should add ppl formatter in the language config
  /**
   * Provide a field, get its formatter
   * @param field
   */
  getFormatterForField(
    field: IndexPatternField | IndexPatternField['spec'] | IFieldType
  ): FieldFormat {
    return (
      this.fieldFormatMap[field.name] ||
      this.fieldFormats.getDefaultInstance(
        field.type as OSD_FIELD_TYPES,
        field.esTypes as OPENSEARCH_FIELD_TYPES[]
      )
    );
  }
}
