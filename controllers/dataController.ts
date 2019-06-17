﻿import { ObeliskClientAuthentication } from "../utils/Authentication";
import { ObeliskDataRetrievalOperations } from "../ObeliskQuery/ODataRetrievalOperations";
import { IObeliskSpatialQueryCodeAndResults, IObeliskMetadataMetricsQueryCodeAndResults } from "../ObeliskQuery/ObeliskQueryInterfaces";
import { GeoHashUtils, Tile } from "../utils/GeoHashUtils";
import { ObeliskQueryMetadata } from "../ObeliskQuery/OQMetadata";
import { IQueryResults, IMetricResults } from "../API/APIInterfaces";
import { QueryResults, MetricResults } from "../API/QueryResults";
import { AirQualityServerConfig } from "../AirQualityServerConfig";


let auth: ObeliskClientAuthentication = null;
async function startAuth(): Promise<void> {
    auth = new ObeliskClientAuthentication(AirQualityServerConfig.ObeliskClientId, AirQualityServerConfig.ObeliskClientSecret, false);
    await auth.initTokens();
}
async function getAuth(): Promise<ObeliskClientAuthentication> {
    if (!auth) await startAuth();
    return auth;
}


let obeliskDataRetrievalOperations: ObeliskDataRetrievalOperations = null;
async function startObeliskDataRetrievalOperations(scopeId: string): Promise<void> {
    obeliskDataRetrievalOperations = new ObeliskDataRetrievalOperations(scopeId, await getAuth(), true);
}
async function getObeliskDataRetrievalOperations(scopeId: string): Promise<ObeliskDataRetrievalOperations> {
    if (!obeliskDataRetrievalOperations) await startObeliskDataRetrievalOperations(scopeId);
    return obeliskDataRetrievalOperations;
}


let metricIds: string[] = new Array();
async function startGetMetricIds(scopeId: string): Promise<void> {
    let metadata: IObeliskMetadataMetricsQueryCodeAndResults = await (new ObeliskQueryMetadata(AirQualityServerConfig.scopeId, await getAuth(), true)).GetMetrics();
    for (let x of metadata.results) {
        metricIds.push(x.id);
    }
}
async function getMetricIds(scopeId: string): Promise<string[]> {
    if (metricIds.length == 0) await startGetMetricIds(scopeId);
    return metricIds;
}

function processEvents(data: IObeliskSpatialQueryCodeAndResults[], geoHashUtils: GeoHashUtils, metrics): IQueryResults {
    let queryResults = new QueryResults();
    queryResults.columns = data[0].results.columns;
    let id: number = 0;
    for (let d of data) {
        let metricResults: IMetricResults = new MetricResults(metrics[id]);
        id++;
        //filter geoHashes - within tile requirement
        let colNr = d.results.columns.indexOf(AirQualityServerConfig.geoHashColumnName);
        for (let r of d.results.values) {
            let ii = geoHashUtils.isWithinTile(r[colNr].toString());
            if (ii) {
                metricResults.AddValues(r);
            }
        }
        queryResults.AddMetricResults(metricResults);
    }
    return queryResults;
}

//results are 'latest'
exports.data_get_z_x_y = async function (req, res): Promise<void> {
    let metrics: string[];

    try {
        //get metrics from request
        if (req.query.metrics) {
            metrics = req.query.metrics.split(',');
            console.log('metrics:', metrics);
        }
        else { //option : if no metricids are given, take all from metaquery
            metrics = await getMetricIds(AirQualityServerConfig.scopeId);
            console.log(metrics);
            //console.log("no metrics");            
            //throw "no metrics";
        }
        //convert tile to geoHashes
        let tile: Tile = { x: Number(req.params.tile_x), y: Number(req.params.tile_y), zoom: Number(req.params.zoom) };
        //let t: Tile = { x: 4195, y: 2734, zoom: 13 };
        let geoHashUtiles = new GeoHashUtils(tile);
        let gHashes: string[] = geoHashUtiles.getGeoHashes();
        console.log(gHashes);
        let DR: ObeliskDataRetrievalOperations = await getObeliskDataRetrievalOperations(AirQualityServerConfig.scopeId);
        let qRes: Promise<IObeliskSpatialQueryCodeAndResults>[] = new Array();
        for (let i = 0; i < metrics.length; i++) {
            qRes[i] = DR.GetEventsLatest(metrics[i], gHashes);
        }
        await Promise.all(qRes).then(data => { return processEvents(data, geoHashUtiles, metrics); }).then(data => res.send(data));      
    }
    catch (error) {
        console.log(error);
        res.send(error);
    }
 }