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

import { isObject } from 'lodash';
import { SavedObjectsClientContract, SavedObjectAttributes, CoreStart } from 'src/core/public';
import { first } from 'rxjs/operators';
import { SavedQueryAttributes, SavedQuery, SavedQueryService } from './types';
import { QueryStringContract } from '../query_string';
import { getUseNewSavedQueriesUI } from '../../services';
import { UI_SETTINGS } from '../../../common';

type SerializedSavedQueryAttributes = SavedObjectAttributes & SavedQueryAttributes;

const unregisteredLangServiceApps = ['explore'];

export const createSavedQueryService = (
  savedObjectsClient: SavedObjectsClientContract,
  coreStartServices: { application: CoreStart['application']; uiSettings: CoreStart['uiSettings'] },
  queryStringManager?: QueryStringContract
): SavedQueryService => {
  const { application, uiSettings } = coreStartServices;
  const queryEnhancementEnabled = uiSettings.get(UI_SETTINGS.QUERY_ENHANCEMENTS_ENABLED);

  const saveQuery = async (attributes: SavedQueryAttributes, { overwrite = false } = {}) => {
    if (!attributes.title.length) {
      // title is required extra check against circumventing the front end
      throw new Error('Cannot create saved query without a title');
    }

    const query: SerializedSavedQueryAttributes['query'] = {
      query:
        typeof attributes.query.query === 'string'
          ? attributes.query.query
          : JSON.stringify(attributes.query.query),
      language: attributes.query.language,
    };

    if (queryEnhancementEnabled && attributes.query.dataset) {
      query.dataset = attributes.query.dataset;
    }

    const queryObject: SavedQueryAttributes = {
      title: attributes.title.trim(), // trim whitespace before save as an extra precaution against circumventing the front end
      description: attributes.description,
      query,
    };

    if (attributes.filters) {
      queryObject.filters = attributes.filters;
    }

    if (attributes.timefilter) {
      queryObject.timefilter = attributes.timefilter;
    }

    if (getUseNewSavedQueriesUI() && attributes.isTemplate) {
      queryObject.isTemplate = true;
    }

    let rawQueryResponse;
    if (!overwrite) {
      rawQueryResponse = await savedObjectsClient.create('query', queryObject, {
        id: attributes.title,
      });
    } else {
      rawQueryResponse = await savedObjectsClient.create('query', queryObject, {
        id: attributes.title,
        overwrite: true,
      });
    }

    if (rawQueryResponse.error) {
      throw new Error(rawQueryResponse.error.message);
    }

    return parseSavedQueryObject(rawQueryResponse);
  };
  // we have to tell the saved objects client how many to fetch, otherwise it defaults to fetching 20 per page
  const getAllSavedQueries = async (): Promise<SavedQuery[]> => {
    const count = await getSavedQueryCount();
    const response = await savedObjectsClient.find<SerializedSavedQueryAttributes>({
      type: 'query',
      perPage: count,
      page: 1,
    });
    return response.savedObjects.map(
      (savedObject: { id: string; attributes: SerializedSavedQueryAttributes }) =>
        parseSavedQueryObject(savedObject)
    );
  };
  // findSavedQueries will do a 'match_all' if no search string is passed in
  const findSavedQueries = async (
    searchText: string = '',
    perPage: number = 50,
    activePage: number = 1
  ): Promise<{ total: number; queries: SavedQuery[] }> => {
    const response = await savedObjectsClient.find<SerializedSavedQueryAttributes>({
      type: 'query',
      search: searchText,
      searchFields: ['title^5', 'description'],
      sortField: '_score',
      perPage,
      page: activePage,
    });

    let queries = response.savedObjects.map(
      (savedObject: { id: string; attributes: SerializedSavedQueryAttributes }) =>
        parseSavedQueryObject(savedObject)
    );

    const currentAppId = (await application?.currentAppId$?.pipe(first()).toPromise()) ?? undefined;
    const languageService = queryStringManager?.getLanguageService();

    // Filtering saved queries based on language supported by current application
    // Skip filtering for apps not using lang service eg. explore new editor
    if (
      currentAppId &&
      languageService &&
      !unregisteredLangServiceApps.some((unregisteredApp) =>
        currentAppId.startsWith(unregisteredApp)
      )
    ) {
      queries = queries.filter((query) => {
        const languageId = query.attributes.query.language;
        return (
          languageService?.getLanguage(languageId)?.supportedAppNames?.includes(currentAppId) ??
          true
        );
      });
    }

    return {
      total: response.total,
      queries,
    };
  };

  const getSavedQuery = async (id: string): Promise<SavedQuery> => {
    const savedObject = await savedObjectsClient.get<SerializedSavedQueryAttributes>('query', id);
    if (savedObject.error) {
      throw new Error(savedObject.error.message);
    }
    return parseSavedQueryObject(savedObject);
  };

  const deleteSavedQuery = async (id: string) => {
    return await savedObjectsClient.delete('query', id);
  };

  const parseSavedQueryObject = (savedQuery: SavedQuery) => {
    const queryString = savedQuery.attributes.query.query as string;
    let parsedQuery;
    try {
      parsedQuery = JSON.parse(queryString);
      parsedQuery = isObject(parsedQuery) ? parsedQuery : queryString;
    } catch (error) {
      parsedQuery = queryString;
    }

    const savedQueryItem: SavedQueryAttributes = {
      title: savedQuery.attributes.title || '',
      description: savedQuery.attributes.description || '',
      query: {
        query: parsedQuery,
        language: savedQuery.attributes.query.language,
      },
    };

    if (queryEnhancementEnabled) {
      savedQueryItem.query.dataset = savedQuery.attributes.query.dataset;
    }

    if (getUseNewSavedQueriesUI()) {
      savedQueryItem.isTemplate = !!savedQuery.attributes.isTemplate;
    }

    if (savedQuery.attributes.filters) {
      savedQueryItem.filters = savedQuery.attributes.filters;
    }
    if (savedQuery.attributes.timefilter) {
      savedQueryItem.timefilter = savedQuery.attributes.timefilter;
    }
    return {
      id: savedQuery.id,
      attributes: savedQueryItem,
    };
  };

  const getSavedQueryCount = async (): Promise<number> => {
    const response = await savedObjectsClient.find<SerializedSavedQueryAttributes>({
      type: 'query',
      // ToDo: Revert this back to `0` when Neo reports the count correctly irrespective of perPage.
      perPage: 1,
      page: 1,
    });
    return response.total;
  };

  return {
    saveQuery,
    getAllSavedQueries,
    findSavedQueries,
    getSavedQuery,
    deleteSavedQuery,
    getSavedQueryCount,
  };
};
