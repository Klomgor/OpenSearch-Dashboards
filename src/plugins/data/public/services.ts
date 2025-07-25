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

import { NotificationsStart, CoreStart, ApplicationStart } from 'src/core/public';
import { FieldFormatsStart } from './field_formats';
import { createGetterSetter } from '../../opensearch_dashboards_utils/public';
import { IndexPatternsContract } from './index_patterns';
import { DataViewsContract } from './data_views';
import { DataPublicPluginStart } from './types';

export const [getNotifications, setNotifications] = createGetterSetter<NotificationsStart>(
  'Notifications'
);

export const [getUiSettings, setUiSettings] = createGetterSetter<CoreStart['uiSettings']>(
  'UiSettings'
);

export const [getFieldFormats, setFieldFormats] = createGetterSetter<FieldFormatsStart>(
  'FieldFormats'
);

export const [getOverlays, setOverlays] = createGetterSetter<CoreStart['overlays']>('Overlays');

export const [getDataViews, setDataViews] = createGetterSetter<DataViewsContract>('DataViews');

export const [getIndexPatterns, setIndexPatterns] = createGetterSetter<IndexPatternsContract>(
  'IndexPatterns'
);

export const [getQueryService, setQueryService] = createGetterSetter<
  DataPublicPluginStart['query']
>('Query');

export const [getSearchService, setSearchService] = createGetterSetter<
  DataPublicPluginStart['search']
>('Search');

export const [getUiService, setUiService] = createGetterSetter<DataPublicPluginStart['ui']>('Ui');

export const [getApplication, setApplication] = createGetterSetter<ApplicationStart>('Application');

let useNewSavedQueriesUI = false;

export function getUseNewSavedQueriesUI() {
  return useNewSavedQueriesUI;
}

export const setUseNewSavedQueriesUI = (value: boolean) => {
  useNewSavedQueriesUI = value;
};
