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
import { createHashHistory } from 'history';
import { ScopedHistory, AppMountParameters } from 'opensearch-dashboards/public';
import { UiActionsStart } from '../../../../../ui_actions/public';
import { ExploreServices } from '../../../types';
import { createGetterSetter } from '../../../../../opensearch_dashboards_utils/public';
import { search } from '../../../../../data/public';
import { DocViewsRegistry } from '../../../types/doc_views_types';
import { DocViewsLinksRegistry } from './application/doc_views_links/doc_views_links_registry';
import { ExpressionsStart } from '../../../../../expressions/public';
import { DashboardStart } from '../../../../../dashboard/public';

let services: ExploreServices | null = null;
let uiActions: UiActionsStart;

export function getServices(): ExploreServices {
  if (!services) {
    throw new Error('Discover services are not yet available');
  }
  return services;
}

export function setServices(newServices: ExploreServices) {
  services = newServices;
}

export const setUiActions = (pluginUiActions: UiActionsStart) => (uiActions = pluginUiActions);
export const getUiActions = () => uiActions;

export const [getHeaderActionMenuMounter, setHeaderActionMenuMounter] = createGetterSetter<
  AppMountParameters['setHeaderActionMenu']
>('headerActionMenuMounter');

export const [getDocViewsRegistry, setDocViewsRegistry] = createGetterSetter<DocViewsRegistry>(
  'DocViewsRegistry'
);

export const [getDocViewsLinksRegistry, setDocViewsLinksRegistry] = createGetterSetter<
  DocViewsLinksRegistry
>('DocViewsLinksRegistry');

/**
 * Makes sure discover and context are using one instance of history.
 */
export const getHistory = _.once(() => createHashHistory());

/**
 * Discover currently uses two `history` instances: one from OpenSearch Dashboards Platform and
 * another from `history` package. Below function is used every time Discover
 * app is loaded to synchronize both instances.
 *
 * This helper is temporary until https://github.com/elastic/kibana/issues/65161 is resolved.
 */
export const syncHistoryLocations = () => {
  const h = getHistory();
  Object.assign(h.location, createHashHistory().location);
  return h;
};

export const [getScopedHistory, setScopedHistory] = createGetterSetter<ScopedHistory>(
  'scopedHistory'
);

export const { getRequestInspectorStats, getResponseInspectorStats, tabifyAggResponse } = search;
export { unhashUrl, redirectWhenMissing } from '../../../../../opensearch_dashboards_utils/public';
export { formatMsg, formatStack } from '../../../../../opensearch_dashboards_legacy/public';

// EXPORT types
export {
  IndexPatternsContract,
  IIndexPattern,
  IndexPattern,
  indexPatterns,
  IFieldType,
  ISearchSource,
  OpenSearchQuerySortValue,
  SortDirection,
  DataViewsContract,
  IDataView as IDataset,
  DataView as Dataset,
  dataViews as datasets,
} from '../../../../../data/public';

export const [getExpressionLoader, setExpressionLoader] = createGetterSetter<
  ExpressionsStart['ExpressionLoader']
>('expressions.ExpressionLoader');

export const [getDashboard, setDashboard] = createGetterSetter<DashboardStart>('Dashboard');

export const [getDashboardVersion, setDashboardVersion] = createGetterSetter<{ version: string }>(
  'DashboardVersion'
);
