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

import { memoize } from 'lodash';
import { CoreSetup } from 'src/core/public';
import { IIndexPattern, IFieldType, UI_SETTINGS, IndexPattern } from '../../../common';

function resolver(title: string, field: IFieldType, query: string, boolFilter: any) {
  // Only cache results for a minute
  const ttl = Math.floor(Date.now() / 1000 / 60);

  return [ttl, query, title, field.name, JSON.stringify(boolFilter)].join('|');
}

export type ValueSuggestionsGetFn = (args: ValueSuggestionsGetFnArgs) => Promise<any[]>;

interface ValueSuggestionsGetFnArgs {
  indexPattern: IIndexPattern;
  field: IFieldType;
  query: string;
  boolFilter?: any[];
  signal?: AbortSignal;
}

export const getEmptyValueSuggestions = (() => Promise.resolve([])) as ValueSuggestionsGetFn;

export const setupValueSuggestionProvider = (core: CoreSetup): ValueSuggestionsGetFn => {
  const requestSuggestions = memoize(
    (
      index: string,
      field: IFieldType,
      query: string,
      boolFilter: any = [],
      signal?: AbortSignal,
      dataSourceId?: string
    ) =>
      core.http.fetch(`/api/opensearch-dashboards/suggestions/values/${index}`, {
        method: 'POST',
        body: JSON.stringify({ query, field: field.name, boolFilter, dataSourceId }),
        signal,
      }),
    resolver
  );

  return async ({
    indexPattern,
    field,
    query,
    boolFilter,
    signal,
  }: ValueSuggestionsGetFnArgs): Promise<any[]> => {
    const shouldSuggestValues = core!.uiSettings.get<boolean>(
      UI_SETTINGS.FILTERS_EDITOR_SUGGEST_VALUES
    );
    const { title } = indexPattern;

    if (field.type === 'boolean') {
      return [true, false];
    } else if (!shouldSuggestValues || !field.aggregatable || field.type !== 'string') {
      return [];
    }
    return await requestSuggestions(
      title,
      field,
      query,
      boolFilter,
      signal,
      (indexPattern as IndexPattern).dataSourceRef?.id
    );
  };
};
