/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildExpression,
  buildExpressionFunction,
  ExpressionFunctionOpenSearchDashboards,
  IExpressionLoaderParams,
} from '../../../../../expressions/public';
import { IndexPattern, DataView as Dataset } from '../../../../../data/public';
import { VisColumn } from '../types';

/**
 * Convert the visualization configuration to an expression
 * @param searchContext The search context
 * @param indexPattern The index pattern
 * @param transformedData The transformed data
 * @param numericalColumns The numerical columns
 * @param categoricalColumns The categorical columns
 * @param dateColumns The date columns
 * @param styleOptions The style options
 * @param toExpressionFn Specific function to create the Vega spec based on the rule
 * @returns The expression string
 */
export const toExpression = (
  searchContext: IExpressionLoaderParams['searchContext'],
  indexPattern: IndexPattern | Dataset,
  toExpressionFn: (
    transformedData: Array<Record<string, any>>,
    numericalColumns: VisColumn[],
    categoricalColumns: VisColumn[],
    dateColumns: VisColumn[],
    styleOptions: any
  ) => any,
  transformedData?: Array<Record<string, any>>,
  numericalColumns?: VisColumn[],
  categoricalColumns?: VisColumn[],
  dateColumns?: VisColumn[],
  styleOptions?: any
) => {
  if (!indexPattern || !searchContext) {
    return '';
  }

  const opensearchDashboards = buildExpressionFunction<ExpressionFunctionOpenSearchDashboards>(
    'opensearchDashboards',
    {}
  );
  const opensearchDashboardsContext = buildExpressionFunction('opensearch_dashboards_context', {
    timeRange: JSON.stringify(searchContext.timeRange || {}),
    filters: JSON.stringify(searchContext.filters || []),
    query: JSON.stringify(searchContext.query || []),
  });

  const vegaSpec = toExpressionFn(
    transformedData!,
    numericalColumns!,
    categoricalColumns!,
    dateColumns!,
    styleOptions
  );

  const vega = buildExpressionFunction<any>('vega', {
    spec: JSON.stringify(vegaSpec),
  });

  return buildExpression([opensearchDashboards, opensearchDashboardsContext, vega]).toString();
};
