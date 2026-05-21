import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule } from "@angular/forms";
import { FieldType, FieldTypeConfig, FormlyModule } from "@ngx-formly/core";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { NzModalService } from "ng-zorro-antd/modal";
import { NzInputModule } from "ng-zorro-antd/input";
import { NzIconModule } from "ng-zorro-antd/icon";
import { ClusterSelectionComponent } from "../cluster-selection/cluster-selection.component";
import { ClusterService } from "src/app/common/service/cluster/cluster.service";
import { environment } from "src/environments/environment";

@UntilDestroy()
@Component({
  selector: "texera-cluster-autocomplete-template",
  templateUrl: "./cluster-autocomplete.component.html",
  styleUrls: ["cluster-autocomplete.component.scss"],
  imports: [CommonModule, ReactiveFormsModule, FormlyModule, NzInputModule, NzIconModule],
})
export class ClusterAutoCompleteComponent extends FieldType<FieldTypeConfig> {
  constructor(
    private modalService: NzModalService,
    private clusterService: ClusterService
  ) {
    super();
  }

  onClickOpenClusterSelectionModal(): void {
    this.clusterService
      .getClusters(true)
      .pipe(untilDestroyed(this))
      .subscribe(clusters => {
        const modal = this.modalService.create({
          nzTitle: "Select Cluster",
          nzContent: ClusterSelectionComponent,
          nzData: { clusters: clusters },
          nzFooter: null,
        });

        modal.afterClose.pipe(untilDestroyed(this)).subscribe(selectedCluster => {
          if (selectedCluster) {
            // Format the value as #cid name
            const formattedValue = `#${selectedCluster.cid} ${selectedCluster.name}`;
            this.formControl.setValue(formattedValue);
          }
        });
      });
  }
  get isClusterSelectionEnabled(): boolean {
    return true;
  }
}
