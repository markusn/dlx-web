/**
 * @author Markus Ekholm
 * @copyright 2019 (c) Markus Ekholm <markus at botten dot org >
 * @license Copyright (c) 2019, Markus Ekholm
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *    * Redistributions of source code must retain the above copyright
 *      notice, this list of conditions and the following disclaimer.
 *    * Redistributions in binary form must reproduce the above copyright
 *      notice, this list of conditions and the following disclaimer in the
 *      documentation and/or other materials provided with the distribution.
 *    * Neither the name of the author nor the
 *      names of its contributors may be used to endorse or promote products
 *      derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL MARKUS EKHOLM BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import React from "react";
import {render} from "react-dom";
import "bootstrap/dist/css/bootstrap.min.css";
//import $ from "jquery";
//import Popper from "popper.js";
import "bootstrap/dist/js/bootstrap.bundle.min";
import "react-bootstrap-table-next/dist/react-bootstrap-table2.min.css";
import BootstrapTable from "react-bootstrap-table-next";
import axios from "axios";

import ReactJson from "react-json-view";

export default class App extends React.Component {
  constructor() {
    super();
    this.state = {
      data: {},
      selected: []
    };
  }

  fetchMessages() {
    fetch("/api/messages")
      .then((res) => res.json())
      .then((body) => {
        const {data, selected} = this.state;
        const newData = {};
        const newSelected = [];
        body.messages.forEach((msg) => {
          if (!data[msg.id]) {
            console.log("adding row", msg.id);
            newData[msg.id] = msg;
          }
          if (data[msg.id]) {
            console.log("reusing row", msg.id);
            if (selected.includes(msg.id)) newSelected.push(msg.id);
            newData[msg.id] = data[msg.id];
          }
        });
        this.setState({data: newData, selected: newSelected});
      });
  }

  componentDidMount() {
    this.fetchMessages();
  }

  componentWillUnmount() {}

  handleBtnClickResend = () => {
    const {data} = this.state;
    const promises = this.state.selected.map((msgId) => {
      const row = data[msgId];
      if (!row) console.log("no data for msg with id", msgId, data);
      return axios.post(`/api/messages/${msgId}/resend`, row.message);
    });
    if (promises.length > 0) {
      Promise.all(promises).then(() => {
        console.log("resent", this.state.selected);
        setTimeout(() => this.fetchMessages(), 1000);
      });
    }
  };

  handleBtnClickDelete = () => {
    const promises = this.state.selected.map((msgId) => {
      return axios.post(`/api/messages/${msgId}/delete`);
    });
    Promise.all(promises).then(() => {
      console.log("deleted", this.state.selected);
      setTimeout(() => this.fetchMessages(), 1000);
    });
  };

  handleOnSelect = (row, isSelect) => {
    if (isSelect) {
      this.setState(() => ({
        selected: [...this.state.selected, row.id]
      }));
    } else {
      this.setState(() => ({
        selected: this.state.selected.filter((x) => x !== row.id)
      }));
    }
  };

  handleOnSelectAll = (isSelect, rows) => {
    const ids = rows.map((r) => r.id);
    if (isSelect) {
      this.setState(() => ({
        selected: ids
      }));
    } else {
      this.setState(() => ({
        selected: []
      }));
    }
  };

  handleMessageEdit = (o, id) => {
    const {data} = this.state;
    const src = data[id];
    console.log({o});
    src.message = o.updated_src;
    this.setState({data});
    return true;
  };

  render() {
    const {data} = this.state;
    const columns = [
      {text: "First occurred", dataField: "ts", sort: true},
      {text: "Id", dataField: "id", hidden: true},
      {text: "Queues", dataField: "queues", sort: true},
      {text: "Routing Key", dataField: "routingKey", sort: true},
      {text: "Correlation Id", dataField: "correlationId", sort: true}
    ];
    const selectRowProp = {
      clickToExpand: true,
      selected: this.state.selected,
      onSelect: this.handleOnSelect,
      onSelectAll: this.handleOnSelectAll,
      bgColor: "#00BFFF",
      mode: "checkbox" // single row selection
    };

    const expandRow = {
      renderer: (row) => {
        return (
          <div>
            <ReactJson
              rowId={row.id}
              src={row.message}
              name={null}
              indentWidth={2}
              displayObjectSize={false}
              displayDataTypes={false}
              enableClipboard={false}
              onEdit={(o) => this.handleMessageEdit(o, row.id)}
              onAdd={(o) => this.handleMessageEdit(o, row.id)}
              onDelete={(o) => this.handleMessageEdit(o, row.id)}
            />
          </div>
        );
      }
    };

    return (
      <div>
        <h1>DLX Web</h1>
        <BootstrapTable
          bootstrap4={true}
          data={Object.values(data)}
          keyField="id"
          columns={columns}
          selectRow={selectRowProp}
          expandRow={expandRow}
          headerClasses="thead-light"
        />
        <div className="btn-toolbar" role="toolbar" aria-label="Toolbar with button groups">
          <div className="btn-group mr-2" role="group" aria-label="First group">
            <button className="btn btn-primary" onClick={this.handleBtnClickResend}>
              Resend
            </button>
          </div>
          <div className="btn-group mr-2" role="group" aria-label="Secondary group">
            <button className="btn btn-secondary" onClick={this.handleBtnClickDelete}>
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  }
}

render(<App />, document.getElementById("root"));
